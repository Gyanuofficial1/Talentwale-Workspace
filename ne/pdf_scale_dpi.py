import argparse
import sys
from pathlib import Path
from typing import Optional

import fitz  # PyMuPDF


def rasterize_pdf_to_dpi(input_pdf: Path, output_pdf: Path, dpi: int) -> None:
    if dpi <= 0:
        raise ValueError("DPI must be greater than 0.")

    zoom = dpi / 72.0
    matrix = fitz.Matrix(zoom, zoom)

    src = fitz.open(input_pdf)
    dst = fitz.open()

    try:
        for page in src:
            # Render each source page at requested DPI.
            pix = page.get_pixmap(matrix=matrix, alpha=False)

            # Keep original page dimensions and place the raster image on it.
            new_page = dst.new_page(width=page.rect.width, height=page.rect.height)
            new_page.insert_image(new_page.rect, pixmap=pix)

        dst.save(output_pdf, deflate=True, garbage=4)
    finally:
        src.close()
        dst.close()


def build_output_path(input_pdf: Path, dpi: int, output_arg: Optional[str]) -> Path:
    if output_arg:
        return Path(output_arg)
    return input_pdf.with_name(f"{input_pdf.stem}_{dpi}dpi.pdf")


def main() -> None:
    if len(sys.argv) == 1:
        input_path = input("PDF ka path dijiye: ").strip().strip('"')
        dpi_text = input("DPI dijiye (example 150, 300, 600): ").strip()
        output_path = input(
            "Output path (optional, blank chhodiye for auto name): "
        ).strip().strip('"')

        if not input_path:
            raise ValueError("Input PDF path required.")
        if not dpi_text.isdigit() or int(dpi_text) <= 0:
            raise ValueError("DPI must be a positive integer.")

        input_pdf = Path(input_path)
        if not input_pdf.exists():
            raise FileNotFoundError(f"Input file not found: {input_pdf}")
        if input_pdf.suffix.lower() != ".pdf":
            raise ValueError("Input file must be a PDF.")

        output_pdf = build_output_path(
            input_pdf,
            int(dpi_text),
            output_path if output_path else None,
        )
        rasterize_pdf_to_dpi(input_pdf, output_pdf, int(dpi_text))
        print(f"Done. Output saved to: {output_pdf}")
        return

    parser = argparse.ArgumentParser(
        description="Scale (rasterize) a PDF at a chosen DPI and save as a new PDF."
    )
    parser.add_argument("input", help="Input PDF file path")
    parser.add_argument("dpi", type=int, help="Target DPI (example: 150, 300, 600)")
    parser.add_argument(
        "-o",
        "--output",
        help="Output PDF path (default: inputname_<dpi>dpi.pdf in same folder)",
    )

    args = parser.parse_args()

    input_pdf = Path(args.input)
    if not input_pdf.exists():
        raise FileNotFoundError(f"Input file not found: {input_pdf}")
    if input_pdf.suffix.lower() != ".pdf":
        raise ValueError("Input file must be a PDF.")

    output_pdf = build_output_path(input_pdf, args.dpi, args.output)

    rasterize_pdf_to_dpi(input_pdf, output_pdf, args.dpi)
    print(f"Done. Output saved to: {output_pdf}")


if __name__ == "__main__":
    main()
