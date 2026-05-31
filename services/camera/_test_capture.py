from capture import CameraCapture
import time, cv2

cap = CameraCapture("0", fps=10, width=640, height=480)
cap.start()
print("Esperando frames...")
time.sleep(3)

frame = cap.latest_frame()
if frame is not None:
    print(f"Frame recibido: {frame.shape}")
    cv2.imwrite("/tmp/test_frame.jpg", frame)
    print("Imagen guardada en /tmp/test_frame.jpg")
else:
    print("Sin frames — revisar permisos de camara en System Settings > Privacy > Camera")

cap.stop()
