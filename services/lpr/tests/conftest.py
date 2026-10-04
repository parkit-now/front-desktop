"""Infraestructura mínima para testear el reconocedor sin cargar modelos.

`recognizer.py` importa `fast_alpr`, pero los modelos recién se bajan y se
cargan al construir `PlateRecognizer`. Los tests arman el reconocedor con un
detector y un OCR falsos, así que corren offline y en milisegundos.
"""

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
