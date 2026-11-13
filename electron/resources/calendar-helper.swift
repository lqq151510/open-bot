import EventKit
import Foundation

private struct CalendarOption: Encodable {
    let id: String
    let title: String
    let account: String
}

private struct TimeSpan: Encodable {
    let start: Int64
    let end: Int64

    init(start: Date, end: Date) {
        self.start = milliseconds(start)
        self.end = milliseconds(end)
    }
}

private struct CalendarEvent: Encodable {
    let title: String
    let calendar: String
    let time: TimeSpan
    let allDay: Bool
    let busy: Bool

    init(_ event: EKEvent) {
        title = String((event.title ?? "").prefix(250))
        calendar = String(event.calendar.title.prefix(120))
        time = TimeSpan(start: event.startDate, end: max(event.startDate, event.endDate))
        allDay = event.isAllDay
        busy = event.endDate > event.startDate && (event.availability == .busy || event.availability == .unavailable ||
            (!event.isAllDay && event.availability != .free))
    }
}

private struct Preview: Encodable {
    let timeZone: String
    let period: TimeSpan
    let workingHours: [TimeSpan]
    let events: [CalendarEvent]
    let truncated: Bool
}

private struct Reply: Encodable {
    let status: String
    var calendars: [CalendarOption]? = nil
    var preview: Preview? = nil
}

private func milliseconds(_ date: Date) -> Int64 {
    Int64((date.timeIntervalSince1970 * 1000).rounded())
}

private func authorization() -> String {
    switch EKEventStore.authorizationStatus(for: .event) {
    case .notDetermined: return "notDetermined"
    case .restricted: return "restricted"
    case .denied: return "denied"
    case .writeOnly: return "writeOnly"
    case .fullAccess: return "granted"
    @unknown default: return "unavailable"
    }
}

@main
private struct CalendarHelper {
    @MainActor static func main() async throws {
        let args = CommandLine.arguments
        guard args.count >= 3 else { return }
        DispatchQueue.global().asyncAfter(deadline: .now() + 85) { exit(1) }
        let reply = try await respond(to: Array(args.dropFirst(2)))
        try JSONEncoder().encode(reply).write(to: URL(fileURLWithPath: args[1]), options: .atomic)
    }

    @MainActor private static func respond(to args: [String]) async throws -> Reply {
        let command = args.first
        var status = authorization()
        if command == "status" { return Reply(status: status) }
        if command != "request" && status != "granted" { return Reply(status: status) }
        let store = EKEventStore()
        if command == "request" && (status == "notDetermined" || status == "writeOnly") {
            do {
                _ = try await store.requestFullAccessToEvents()
            } catch {
                status = authorization()
                return Reply(status: status == "notDetermined" ? "unavailable" : status)
            }
            status = authorization()
        }
        guard status == "granted" else { return Reply(status: status) }
        let calendars = store.calendars(for: .event)
        if command == "list" || command == "request" {
            let choices = calendars.map {
                CalendarOption(id: $0.calendarIdentifier, title: String($0.title.prefix(120)), account: String($0.source.title.prefix(120)))
            }.sorted { $0.title.localizedStandardCompare($1.title) == .orderedAscending }
            return Reply(status: status, calendars: choices)
        }
        guard command == "events", args.count >= 3, let days = Int(args[1]), days == 1 || days == 7 else {
            return Reply(status: "unavailable")
        }
        let ids = Set(args.dropFirst(2))
        let selected = calendars.filter { ids.contains($0.calendarIdentifier) }
        guard selected.count == ids.count else { return Reply(status: "selectionChanged") }
        let now = Date()
        var clock = Calendar(identifier: .gregorian)
        clock.timeZone = .current
        let start = clock.startOfDay(for: now)
        guard let end = clock.date(byAdding: .day, value: days, to: start) else { return Reply(status: "unavailable") }
        let predicate = store.predicateForEvents(withStart: start, end: end, calendars: selected)
        let matches = store.events(matching: predicate).filter { event in
            event.status != .canceled && event.startDate < end && (event.endDate > start || event.startDate >= start) &&
                !(event.attendees?.contains { $0.isCurrentUser && $0.participantStatus == .declined } ?? false)
        }.sorted { $0.compareStartDate(with: $1) == .orderedAscending }
        let workingHours = (0..<days).compactMap { offset -> TimeSpan? in
            guard let day = clock.date(byAdding: .day, value: offset, to: start),
                  let opening = clock.date(bySettingHour: 9, minute: 0, second: 0, of: day),
                  let closing = clock.date(bySettingHour: 18, minute: 0, second: 0, of: day) else { return nil }
            let remaining = max(opening, now)
            return remaining < closing ? TimeSpan(start: remaining, end: closing) : nil
        }
        let maxEvents = 100
        let preview = Preview(timeZone: clock.timeZone.identifier, period: TimeSpan(start: start, end: end),
            workingHours: workingHours, events: matches.prefix(maxEvents).map(CalendarEvent.init), truncated: matches.count > maxEvents)
        return Reply(status: status, preview: preview)
    }
}
