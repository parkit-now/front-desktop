import cv2
import lpr_client

frame = cv2.imread("/tmp/test_frame.jpg")
print("Enviando frame al LPR service...")
result = lpr_client.recognize(frame)
print("Resultado:", result)
