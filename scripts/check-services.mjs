#!/usr/bin/env node
/**
 * Preflight check — verifica que los binarios Python existan antes de que
 * electron-builder empaquete la app. Se ejecuta automáticamente via los
 * hooks prepack/predist (empaquetado para el SO actual) o explícitamente
 * con un target (`node scripts/check-services.mjs win`) desde los scripts
 * pack:<os>/dist:<os>.
 *
 * El target NO se infiere de `process.platform`: ese valor es el SO donde
 * corre este script, no necesariamente el SO para el que electron-builder
 * va a empaquetar (p. ej. no se puede generar el .exe de Windows en macOS,
 * pero si se pudiera, `process.platform` seguiría siendo 'darwin').
 */
import { existsSync } from 'node:fs';

const PLATFORM_EXT = { win: '.exe', mac: '', linux: '' };
const HOST_TO_TARGET = { win32: 'win', darwin: 'mac', linux: 'linux' };

const arg = process.argv[2];
const target = arg ?? HOST_TO_TARGET[process.platform];

if (!target || !(target in PLATFORM_EXT)) {
  console.error(
    `Error: target desconocido "${arg ?? process.platform}". ` +
      'Uso: node scripts/check-services.mjs [mac|win|linux]',
  );
  process.exit(1);
}

const ext = PLATFORM_EXT[target];
const required = [
  `services/lpr/dist/lpr-service${ext}`,
  `services/camera/dist/camera-service${ext}`,
];

const missing = required.filter((p) => !existsSync(p));

if (missing.length > 0) {
  console.error(
    `Error: binarios de servicios Python faltantes para target "${target}".\n` +
      'Los binarios de PyInstaller son nativos del SO: no se pueden generar ' +
      '.exe de Windows compilando en macOS/Linux (y viceversa). Compilarlos ' +
      'en una máquina con ese SO:\n\n' +
      '  cd services/lpr    && make lpr-build    && cd ../..\n' +
      '  cd services/camera && make camera-build && cd ../..',
  );
  console.error('\nFaltantes:');
  missing.forEach((p) => console.error(`  ${p}`));
  process.exit(1);
}

console.log(`check-services: binarios OK (target: ${target})`);
