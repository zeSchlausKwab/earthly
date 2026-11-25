import 'package:material_ui/material_ui.dart';
import 'package:qr/qr.dart';

/// Pure-Dart, high-contrast QR code widget working identically across Android,
/// iOS, macOS, Linux, Windows, and Web for Nearby Field Session pairing.
class EarthlyQrCode extends StatelessWidget {
  const EarthlyQrCode({
    required this.data,
    this.size = 200,
    super.key,
  });

  final String data;
  final double size;

  @override
  Widget build(BuildContext context) {
    final qrCode = QrCode(
      payload: QrPayload.fromString(data),
      errorCorrectLevel: QrErrorCorrectLevel.medium,
    );
    final qrImage = QrImage(qrCode);

    return Container(
      width: size,
      height: size,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: Colors.black.withValues(alpha: 0.2)),
      ),
      child: CustomPaint(
        painter: _QrPainter(qrImage),
      ),
    );
  }
}

class _QrPainter extends CustomPainter {
  const _QrPainter(this.qrImage);

  final QrImage qrImage;

  @override
  void paint(Canvas canvas, Size size) {
    final count = qrImage.moduleCount;
    if (count <= 0) return;
    final cell = size.width / count;
    final paint = Paint()
      ..color = Colors.black
      ..style = PaintingStyle.fill;

    for (var y = 0; y < count; y++) {
      for (var x = 0; x < count; x++) {
        if (qrImage.isDark(y, x)) {
          canvas.drawRect(
            Rect.fromLTWH(x * cell, y * cell, cell + 0.35, cell + 0.35),
            paint,
          );
        }
      }
    }
  }

  @override
  bool shouldRepaint(covariant _QrPainter oldDelegate) =>
      oldDelegate.qrImage != qrImage;
}
