// CONFIGURACIÓN DE LA APP
// Pegá acá la URL de tu implementación de Apps Script (Implementar > Nueva implementación > Aplicación web)
const CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbylmFV-b1yz6bSwVTpUFeFtqsbT3znPy-hCtpKS0zylZi1RLBFaUqGnAPcRpPNE2Q_tnA/exec',

  // Rangos de referencia para colorear los valores de glucemia (mg/dL).
  // Ajustar según lo que indique la diabetóloga.
  RANGO_BAJO: 70,   // por debajo de esto: bajo
  RANGO_ALTO: 180   // por encima de esto: alto
};
