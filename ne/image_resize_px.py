import argparse
import sys
from pathlib import Path
from typing import Optional, Tuple

from PIL import Image


def parse_size(width: Optional[str], height: Optional[str], size: Optional[str]) -> Tuple[int, int]:
    if size:
        if "x" not in size.lower():
            raise ValueError("--size format must be WIDTHxHEIGHT, for example 1920x1080")
        w_text, h_text = size.lower().split("x", 1)
        width = w_text.strip()
        height = h_text.strip()

    if not width or not height:
        raise ValueError("Width and height are required.")
    if not width.isdigit() or not height.isdigit():
        raise ValueError("Width and height must be positive integers.")

    w = int(width)
    h = int(height)
    if w <= 0 or h <= 0:
        raise ValueError("Width and height must be greater than 0.")
    return w, h


def build_output_path(input_image: Path, width: int, height: int, output_arg: Optional[str]) -> Path:
    if output_arg:
        return Path(output_arg)
    return input_image.with_name(f"{input_image.stem}_{width}x{height}{input_image.suffix}")


def resize_image(input_image: Path, output_image: Path, width: int, height: int) -> None:
    with Image.open(input_image) as img:
        # LANCZOS gives good quality while downscaling/upscaling.
        resized = img.resize((width, height), Image.Resampling.LANCZOS)
        resized.save(output_image)


def run_interactive() -> None:
    input_path = input("Image ka path dijiye: ").strip().strip('"')
    width_text = input("Width px dijiye: ").strip()
    height_text = input("Height px dijiye: ").strip()
    output_path = input("Output path (optional, blank for auto name): ").strip().strip('"')

    if not input_path:
        raise ValueError("Input image path required.")

    input_image = Path(input_path)
    if not input_image.exists():
        raise FileNotFoundError(f"Input file not found: {input_image}")

    width, height = parse_size(width_text, height_text, None)
    output_image = build_output_path(input_image, width, height, output_path if output_path else None)
    resize_image(input_image, output_image, width, height)
    print(f"Done. Output saved to: {output_image}")


def main() -> None:
    if len(sys.argv) == 1:
        run_interactive()
        return

    parser = argparse.ArgumentParser(description="Resize an image to an exact pixel size.")
    parser.add_argument("input", help="Input image path (jpg/png/webp/etc.)")
    parser.add_argument("--width", "-w", help="Target width in px")
    parser.add_argument("--height", help="Target height in px")
    parser.add_argument("--size", "-s", help="Target size as WIDTHxHEIGHT (example 1080x1080)")
    parser.add_argument("-o", "--output", help="Output image path")

    args = parser.parse_args()

    input_image = Path(args.input)
    if not input_image.exists():
        raise FileNotFoundError(f"Input file not found: {input_image}")

    width, height = parse_size(args.width, args.height, args.size)
    output_image = build_output_path(input_image, width, height, args.output)
    resize_image(input_image, output_image, width, height)
    print(f"Done. Output saved to: {output_image}")


if __name__ == "__main__":
    main()
