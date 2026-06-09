#!/usr/bin/env node
/**
 * Preflight check — verifica que los binarios Python existan antes de que
 * electron-builder empaquete la app. Se ejecuta automáticamente via los
 * hooks prepack y predist definidos en package.json.
 */
import { existsSync } from 'node:fs';

const ext = process.platform === 'win32' ? '.exe' : '';
const required = [
  `services/lpr/dist/lpr-service${ext}`,
  `services/camera/dist/camera-service${ext}`,
];

const missing = required.filter((p) => !existsSync(p));

if (missing.length > 0) {
  console.error(
    'Error: binarios de servicios Python faltantes.\n' +
      'Compilarlos antes de empaquetar:\n\n' +
      '  cd services/lpr    && make lpr-build    && cd ../..\n' +
      '  cd services/camera && make camera-build && cd ../..',
  );
  console.error('\nFaltantes:');
  missing.forEach((p) => console.error(`  ${p}`));
  process.exit(1);
}

console.log('check-services: binarios OK');
