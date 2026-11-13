import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

func photoJPEG(at url: URL) -> Data? {
    let openOptions = [kCGImageSourceShouldCache: false] as CFDictionary
    guard let source = CGImageSourceCreateWithURL(url as CFURL, openOptions) else { return nil }
    let options = [
        kCGImageSourceCreateThumbnailFromImageAlways: true,
        kCGImageSourceCreateThumbnailWithTransform: true,
        kCGImageSourceThumbnailMaxPixelSize: 3072
    ] as CFDictionary
    guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options) else { return nil }

    let data = NSMutableData()
    guard let destination = CGImageDestinationCreateWithData(data, UTType.jpeg.identifier as CFString, 1, nil) else { return nil }
    let jpegOptions = [
        kCGImageDestinationLossyCompressionQuality: 0.9,
        kCGImageDestinationBackgroundColor: CGColor(gray: 1, alpha: 1)
    ] as CFDictionary
    CGImageDestinationAddImage(destination, image, jpegOptions)
    return CGImageDestinationFinalize(destination) ? data as Data : nil
}
