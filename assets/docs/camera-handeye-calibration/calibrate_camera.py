"""Calibrate a pinhole camera from checkerboard images (OpenCV 4.x).

python calibrate_camera.py --images images --cols 9 --rows 6 --square 0.025
Square size is in metres. cols/rows count INNER corners, not squares.
"""
import argparse
from pathlib import Path
import sys
import cv2
import numpy as np


def calibrate(directory, cols, rows, square, output):
    if cols < 2 or rows < 2 or not np.isfinite(square) or square <= 0:
        raise ValueError('At least 2x2 inner corners and a positive finite square size are required')
    if not directory.is_dir():
        raise ValueError(f'Image directory does not exist: {directory}')
    template = np.zeros((cols * rows, 3), dtype=np.float32)
    template[:, :2] = np.mgrid[0:cols, 0:rows].T.reshape(-1, 2) * square
    objects, images, names = [], [], []
    image_size = None
    for path in sorted(directory.iterdir()):
        if path.suffix.lower() not in {'.png', '.jpg', '.jpeg', '.bmp', '.tif', '.tiff'}:
            continue
        gray = cv2.imdecode(np.fromfile(path, dtype=np.uint8), cv2.IMREAD_GRAYSCALE)
        if gray is None:
            print(f'Skipping unreadable image: {path}', file=sys.stderr)
            continue
        size = (gray.shape[1], gray.shape[0])
        if image_size is not None and size != image_size:
            raise ValueError(f'Mixed image resolutions: {path} is {size}, expected {image_size}')
        image_size = size
        found, corners = cv2.findChessboardCornersSB(gray, (cols, rows))
        if not found:
            print(f'No checkerboard: {path.name}', file=sys.stderr)
            continue
        objects.append(template.copy())
        images.append(corners.astype(np.float32))
        names.append(path.name)
    if len(images) < 5:
        raise ValueError(f'Only {len(images)} valid views; collect at least 5 diverse views (prefer more)')
    rms, matrix, distortion, rotations, translations = cv2.calibrateCamera(
        objects, images, image_size, None, None)
    if not np.isfinite(rms) or not np.isfinite(matrix).all() or not np.isfinite(distortion).all():
        raise ValueError('Calibration produced non-finite values')
    errors = []
    for name, obj, observed, rotation, translation in zip(names, objects, images, rotations, translations):
        projected, _ = cv2.projectPoints(obj, rotation, translation, matrix, distortion)
        residual = observed.reshape(-1, 2) - projected.reshape(-1, 2)
        error = float(np.sqrt(np.mean(np.sum(residual ** 2, axis=1))))
        errors.append(error)
        print(f'{name}: {error:.4f} px RMS')
    if output.suffix.lower() != '.npz':
        raise ValueError('Output filename must end in .npz')
    output.parent.mkdir(parents=True, exist_ok=True)
    np.savez(output, K=matrix, dist=distortion, image_size=np.asarray(image_size),
             rms=rms, per_view_rms=np.asarray(errors), files=np.asarray(names),
             square_metres=square, pattern=np.asarray([cols, rows]),
             rvecs=np.asarray(rotations), tvecs=np.asarray(translations))
    print(f'{len(images)} views, RMS={rms:.4f} px; saved {output}')
    print('Validate on held-out images; low fitting RMS alone does not establish accuracy.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--images', type=Path, required=True)
    parser.add_argument('--cols', type=int, default=9)
    parser.add_argument('--rows', type=int, default=6)
    parser.add_argument('--square', type=float, default=0.025)
    parser.add_argument('--output', type=Path, default=Path('camera.npz'))
    args = parser.parse_args()
    try:
        calibrate(args.images, args.cols, args.rows, args.square, args.output)
    except (ValueError, OSError, cv2.error) as error:
        parser.exit(1, f'Calibration failed: {error}\n')


if __name__ == '__main__':
    main()
