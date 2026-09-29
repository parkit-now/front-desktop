import type { InvoiceDocumentDto } from '../../lib/api/arca';

export type { InvoiceDocumentDto };

/**
 * El comprobante de una factura emitida, como HTML listo para pasar a PDF
 * (`window.parkitDesktop.renderPdf`, que usa el Chromium de Electron).
 *
 * Es la plantilla por defecto de `@arcasdk/pdf` (ISC, github.com/ralcorta/arcasdk)
 * portada a TypeScript y recortada a lo que emite Parkit: Factura A, B y C,
 * en pesos, de servicios. El backend ya no dibuja el PDF (necesitaba un
 * Chromium en Cloud Run); le pide los datos a
 * `GET /tenants/:id/invoices/:invoiceId/document`.
 *
 * Todo lo que viene de la factura se escapa: la razón social la escribe el
 * dueño y el receptor sale del padrón.
 */
export function renderInvoiceHtml(
  doc: InvoiceDocumentDto,
  /** El QR (`qrUrl`) ya pasado a imagen, como `data:image/png;base64,…`. */
  qrDataUrl: string | null,
): string {
  const letter = doc.cbteLetra;
  const number = voucherNumber(doc.puntoVenta, doc.cbteNro);
  const title = `FACTURA ${letter} ${number}`;
  const receptorDoc =
    doc.receptor.documentoNro.length === 11
      ? formatCuit(doc.receptor.documentoNro)
      : doc.receptor.documentoNro;
  const periodo =
    doc.fechaServicioDesde && doc.fechaServicioHasta
      ? `<div class="receptor-row"><b>Período facturado:</b> ${formatDate(doc.fechaServicioDesde)} al ${formatDate(doc.fechaServicioHasta)}</div>`
      : '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${esc(title)}</title>
<style>${STYLES}</style>
</head>
<body>
<div class="page">
<div class="content">

  <div class="banner"><span>ORIGINAL</span></div>

  <div class="header">
    <div class="header-top">
      <div class="header-left">
        <div class="emisor-dom">Razón social:</div>
        <div class="emisor-rs">${esc(doc.emisor.razonSocial)}</div>
        <div class="emisor-dom">Domicilio:</div>
        <div class="emisor-dom">${esc(doc.emisor.domicilioComercial)}</div>
      </div>
      <div class="header-center">
        <div class="letter-box">${letter}</div>
        <div class="letter-cod">COD.${String(doc.cbteTipo).padStart(3, '0')}</div>
      </div>
      <div class="header-right">
        <div class="voucher-type">FACTURA ${letter}</div>
        <div class="voucher-nro">Nro.:${number}</div>
        <div class="voucher-fecha">Fecha: ${formatDate(doc.cbteFecha)}</div>
      </div>
    </div>
    <div class="header-bottom">
      <div class="header-bottom-left">
        <span><b>Condición frente al IVA:</b> ${esc(doc.emisor.condicionIva)}</span>
      </div>
      <div class="header-bottom-right">
        <div class="info-row"><span class="lbl">CUIT:</span><span class="val">${formatCuit(doc.emisor.cuit)}</span></div>
        <div class="info-row"><span class="lbl">Ingresos Brutos:</span><span class="val">${esc(doc.emisor.iibb)}</span></div>
        <div class="info-row"><span class="lbl">Fecha de Inicio de Actividades:</span><span class="val">${doc.emisor.fechaInicioActividades ? formatDate(doc.emisor.fechaInicioActividades) : ''}</span></div>
      </div>
    </div>
  </div>

  <div class="receptor">
    <div class="receptor-row"><b>Apellido y nombre / Razón Social:</b> ${esc(doc.receptor.razonSocial)}</div>
    <div class="receptor-row"><b>${esc(doc.receptor.documentoTipo)}:</b> ${esc(receptorDoc)}&nbsp;&nbsp;&nbsp;&nbsp;<b>Condición frente al IVA:</b> ${esc(doc.receptor.condicionIva)}&nbsp;&nbsp;&nbsp;&nbsp;<b>Cond. Venta:</b> ${esc(doc.condicionVenta)} (Vencimiento: ${formatDate(doc.fechaVtoPago)})</div>
    ${periodo}
    <div class="receptor-sep"></div>
  </div>

  <table class="items-table">
    ${itemsHeader(letter)}
    ${doc.items.map((item) => itemRow(letter, item)).join('\n    ')}
  </table>

  <div class="summary-final">
    ${totals(doc)}

    <div class="cae-section">
      ${qrDataUrl ? `<img src="${esc(qrDataUrl)}" class="qr-img" alt="QR de ARCA">` : ''}
      <div class="arca-block">
        <svg class="arca-logo" viewBox="0 0 220 80" xmlns="http://www.w3.org/2000/svg">
          <text x="110" y="48" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="52" font-weight="bold" fill="#3d3d3d" letter-spacing="2">ARCA</text>
          <text x="110" y="64" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="9.5" fill="#3d3d3d" letter-spacing="0.8">AGENCIA DE RECAUDACIÓN</text>
          <text x="110" y="76" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="9.5" fill="#3d3d3d" letter-spacing="0.8">Y CONTROL ADUANERO</text>
        </svg>
        <div class="arca-sub"><i>Comprobante Autorizado</i></div>
        <div class="arca-disclaimer"><i>Esta Administración Federal no se responsabiliza por los datos ingresados en el detalle de la operación.</i></div>
      </div>
    </div>
    <div class="cae-line">CAE N°: ${esc(doc.cae)}&nbsp;&nbsp;&nbsp;&nbsp;Fecha de Vto. de CAE: ${formatDate(doc.caeFechaVencimiento)}</div>
    ${doc.observaciones ? `<div class="observations">Observaciones: ${esc(doc.observaciones)}</div>` : ''}
  </div>

</div>
</div>
</body>
</html>`;
}

type Letter = InvoiceDocumentDto['cbteLetra'];
type Item = InvoiceDocumentDto['items'][number];

/** La A discrimina IVA; la B y la C muestran el precio final. */
function itemsHeader(letter: Letter): string {
  const cells =
    letter === 'A'
      ? [
          ['10%', 'left', 'Cantidad'],
          ['25%', 'left', 'Producto / Servicio'],
          ['13%', 'right', 'Precio unit'],
          ['8%', 'right', '%Bonif.'],
          ['10%', 'right', '$ Bonif.'],
          ['8%', 'right', '%IVA'],
          ['26%', 'right', 'Subtotal s/IVA'],
        ]
      : [
          ['10%', 'left', 'Cantidad'],
          ['30%', 'left', 'Producto / Servicio'],
          ['13%', 'right', 'Precio unit'],
          ['8%', 'right', '%Bonif.'],
          ['10%', 'right', '$ Bonif.'],
          ['29%', 'right', 'Subtotal'],
        ];
  return `<tr class="items-header">${cells
    .map(([width, align, text]) => cell(width, align, text))
    .join('')}</tr>`;
}

function itemRow(letter: Letter, item: Item): string {
  const common = [
    cell('10%', 'left', `${item.cantidad} ${esc(item.unidadMedida)}`),
    cell(letter === 'A' ? '25%' : '30%', 'left', esc(item.descripcion)),
    cell('13%', 'right', formatCurrency(item.precioUnitario)),
    cell('8%', 'right', '0%'),
    cell('10%', 'right', formatCurrency(0)),
  ];
  const tail =
    letter === 'A'
      ? [
          cell(
            '8%',
            'right',
            item.alicuotaIva === null ? '-' : `${item.alicuotaIva}%`,
          ),
          cell('26%', 'right', formatCurrency(item.subtotal)),
        ]
      : [cell('29%', 'right', formatCurrency(item.subtotal))];
  return `<tr class="item-row">${[...common, ...tail].join('')}</tr>`;
}

/** Alícuotas que la plantilla de ARCA lista siempre en la A, aunque den 0. */
const IVA_RATES = ['27%', '21%', '10.5%', '5%', '2.5%', '0%'];

const OTROS_TRIBUTOS = [
  'Per./Ret. de Impuesto a las Ganancias',
  'Per./Ret. de IVA',
  'Per./Ret. Ingresos Brutos',
  'Impuestos Internos',
  'Impuestos Municipales',
];

function totals(doc: InvoiceDocumentDto): string {
  const son = `<div class="son-text">Son PESOS ARGENTINOS ${numberToWords(doc.importeTotal)}</div>`;
  const totalBox = `<div class="total-box">
          <span class="total-box-label">Importe Total:</span>
          <span class="total-box-value">${formatCurrency(doc.importeTotal)}</span>
        </div>`;

  if (doc.cbteLetra === 'C') {
    return `<div class="bottom-col-right">
      ${totalsRow('Importe Neto Gravado:', doc.importeNetoGravado)}
      ${totalBox}
      ${son}
    </div>`;
  }

  const right =
    doc.cbteLetra === 'A'
      ? [
          totalsRow('Importe Neto Gravado:', doc.importeNetoGravado),
          ...IVA_RATES.map((rate) =>
            totalsRow(
              `IVA ${rate}:`,
              doc.iva.find((line) => line.descripcion === rate)?.importe ?? 0,
            ),
          ),
          totalsRow('Importe Otros Tributos:', 0),
        ]
      : [
          totalsRow('Subtotal:', doc.importeNetoGravado),
          totalsRow('Importe Otros Tributos:', 0),
        ];

  return `<div class="bottom-columns">
      <div class="bottom-col-left">
        <table class="tributos-table">
          <colgroup><col class="col-desc" /><col class="col-detalle" /><col class="col-alic" /><col class="col-importe" /></colgroup>
          <tr class="tributos-header"><td colspan="4">Otros Tributos</td></tr>
          <tr class="tributos-subheader"><td>Descripción</td><td>Detalle</td><td class="col-alic">Alic.&nbsp;%</td><td class="col-importe">Importe</td></tr>
          ${OTROS_TRIBUTOS.map(
            (name) =>
              `<tr class="tributos-row"><td>${name}</td><td></td><td></td><td class="col-importe">${formatCurrency(0)}</td></tr>`,
          ).join('\n          ')}
          <tr class="tributos-total"><td colspan="3" class="tributos-total-label">Importe Otros Tributos:</td><td class="col-importe">${formatCurrency(0)}</td></tr>
        </table>
      </div>
      <div class="bottom-col-right">
        ${right.join('\n        ')}
        ${totalBox}
        ${son}
      </div>
    </div>`;
}

function totalsRow(label: string, amount: number): string {
  return `<div class="totals-row"><span class="totals-label">${label}</span><span class="totals-value">${formatCurrency(amount)}</span></div>`;
}

function cell(width: string, align: string, html: string): string {
  return `<td style="width:${width};text-align:${align}">${html}</td>`;
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

/** `2026-09-24` → `24/09/2026`. */
export function formatDate(isoDay: string): string {
  const [year, month, day] = isoDay.slice(0, 10).split('-');
  return day && month && year ? `${day}/${month}/${year}` : isoDay;
}

/** `00001-00000007`: 5 dígitos de punto de venta, como la plantilla de ARCA. */
function voucherNumber(puntoVenta: number, numero: number): string {
  return `${String(puntoVenta).padStart(5, '0')}-${String(numero).padStart(8, '0')}`;
}

function formatCuit(cuit: string): string {
  const clean = cuit.replace(/-/g, '');
  return clean.length === 11
    ? `${clean.slice(0, 2)}-${clean.slice(2, 10)}-${clean.slice(10)}`
    : esc(cuit);
}

/** `1234.5` → `$ 1.234,50` (con espacio duro, para que no se corte). */
export function formatCurrency(amount: number): string {
  const [intPart, decPart] = amount.toFixed(2).split('.');
  const withDots = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `$\u00a0${withDots},${decPart}`;
}

const UNITS = [
  '',
  'un',
  'dos',
  'tres',
  'cuatro',
  'cinco',
  'seis',
  'siete',
  'ocho',
  'nueve',
  'diez',
  'once',
  'doce',
  'trece',
  'catorce',
  'quince',
  'dieciséis',
  'diecisiete',
  'dieciocho',
  'diecinueve',
  'veinte',
  'veintiún',
  'veintidós',
  'veintitrés',
  'veinticuatro',
  'veinticinco',
  'veintiséis',
  'veintisiete',
  'veintiocho',
  'veintinueve',
];
const TENS = [
  '',
  '',
  '',
  'treinta',
  'cuarenta',
  'cincuenta',
  'sesenta',
  'setenta',
  'ochenta',
  'noventa',
];
const HUNDREDS = [
  '',
  'ciento',
  'doscientos',
  'trescientos',
  'cuatrocientos',
  'quinientos',
  'seiscientos',
  'setecientos',
  'ochocientos',
  'novecientos',
];

function intToWords(n: number): string {
  if (n === 0) return 'cero';
  if (n < 30) return UNITS[n];
  if (n < 100) {
    const unit = n % 10;
    const tens = TENS[Math.floor(n / 10)];
    return unit === 0 ? tens : `${tens} y ${UNITS[unit]}`;
  }
  if (n === 100) return 'cien';
  if (n < 1_000) {
    const rest = n % 100;
    const hundreds = HUNDREDS[Math.floor(n / 100)];
    return rest === 0 ? hundreds : `${hundreds} ${intToWords(rest)}`;
  }
  if (n < 1_000_000) {
    const thousands = Math.floor(n / 1_000);
    const rest = n % 1_000;
    const head = thousands === 1 ? 'mil' : `${intToWords(thousands)} mil`;
    return rest === 0 ? head : `${head} ${intToWords(rest)}`;
  }
  if (n < 1_000_000_000) {
    const millions = Math.floor(n / 1_000_000);
    const rest = n % 1_000_000;
    const head =
      millions === 1 ? 'un millón' : `${intToWords(millions)} millones`;
    return rest === 0 ? head : `${head} ${intToWords(rest)}`;
  }
  return String(n);
}

/** `1210.5` → `MIL DOSCIENTOS DIEZ CON 50/100`. */
export function numberToWords(amount: number): string {
  const cents = Math.round((amount * 100) % 100);
  const integer = Math.floor(amount);
  const centStr = `${String(cents).padStart(2, '0')}/100`;
  return `${intToWords(integer).toUpperCase()} CON ${centStr}`;
}

const STYLES = `
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  html,body{font-family:Arial,Helvetica,sans-serif;font-size:8pt;line-height:1.35;color:#000;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  b{font-weight:bold}
  table{border-collapse:collapse;width:100%}
  .page{padding-right:1px;min-height:100vh;display:flex;flex-direction:column}
  .content{flex:1;display:flex;flex-direction:column}
  .banner{border:1pt solid #000;text-align:center;padding:5px 0;margin-bottom:6px}
  .banner span{font-size:12pt;font-weight:bold}
  .header{border:1pt solid #000;margin-bottom:6px}
  .header-top{display:flex;min-height:75px}
  .header-left{flex:1;border-right:1pt solid #000;padding:8px;display:flex;flex-direction:column;justify-content:center}
  .header-left .emisor-rs{font-size:10pt;font-weight:bold;margin:2px 0}
  .header-left .emisor-dom{font-size:7.5pt;margin-bottom:1px}
  .header-center{width:54px;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;padding-top:6px;border-bottom:1pt solid #000}
  .letter-box{width:46px;height:46px;border:1pt solid #000;display:flex;align-items:center;justify-content:center;font-size:28pt;font-weight:bold}
  .letter-cod{font-size:7pt;margin-top:2px;text-align:center}
  .header-right{flex:1;border-left:1pt solid #000;padding:8px;display:flex;flex-direction:column;justify-content:center;text-align:right}
  .header-right .voucher-type{font-size:13pt;font-weight:bold}
  .header-right .voucher-nro{font-size:11pt;font-weight:bold;margin-top:3px}
  .header-right .voucher-fecha{font-size:9pt;font-weight:bold;margin-top:6px}
  .header-bottom{display:flex;min-height:36px}
  .header-bottom-left{flex:1;border-right:1pt solid #000;padding:5px 8px;font-size:7.5pt;display:flex;align-items:center}
  .header-bottom-right{flex:1;padding:4px 10px;display:flex;flex-direction:column;justify-content:center}
  .info-row{display:flex;justify-content:flex-end;gap:6px;margin-bottom:1px}
  .info-row .lbl{font-weight:bold;font-size:7.5pt}
  .info-row .val{font-size:7.5pt}
  .receptor{padding:6px 8px;margin-bottom:4px}
  .receptor-row{margin-bottom:3px;font-size:8pt}
  .receptor-sep{border-bottom:1pt solid #000;margin-top:4px}
  .items-table{margin-bottom:4px}
  .items-table .items-header td{background:#f2f2f2;font-weight:bold;font-size:7.5pt;padding:5px 4px;border:1pt solid #000}
  .items-table .item-row td{font-size:7.5pt;padding:5px 4px;border-bottom:0.5pt solid #eee}
  .summary-final{margin-top:auto}
  .bottom-columns{display:flex;gap:10px;margin-bottom:6px}
  .bottom-col-left{width:42%}
  .bottom-col-right{width:52%;margin-left:auto}
  .tributos-table{border:1pt solid #000;font-size:7.5pt;width:100%;table-layout:fixed}
  .tributos-table td{padding:3px 5px}
  .tributos-table .col-desc{width:40%}
  .tributos-table .col-detalle{width:14%}
  .tributos-table .col-alic{width:14%;white-space:nowrap;text-align:right}
  .tributos-table .col-importe{width:32%;white-space:nowrap;text-align:right}
  .tributos-header td{background:#f0f0f0;font-weight:bold;border-bottom:1pt solid #000}
  .tributos-subheader td{font-weight:bold;border-bottom:0.5pt solid #ccc}
  .tributos-subheader td:last-child{text-align:right}
  .tributos-row td:last-child{text-align:right}
  .tributos-total td{font-weight:bold;border-top:1pt solid #000}
  .tributos-total .tributos-total-label{text-align:right;padding-right:2px}
  .tributos-total td.col-importe{text-align:right}
  .totals-row{display:flex;justify-content:flex-end;margin-bottom:1px}
  .totals-label{text-align:right;font-size:8pt;padding-right:8px;width:60%}
  .totals-value{text-align:right;font-size:8pt;width:40%}
  .total-box{display:flex;border:1pt solid #000;padding:4px 6px;margin:4px 0}
  .total-box-label{width:60%;text-align:right;font-size:11pt;font-weight:bold;padding-right:8px}
  .total-box-value{width:40%;text-align:right;font-size:11pt;font-weight:bold}
  .son-text{font-size:7pt;text-align:right;margin-top:2px}
  .cae-section{display:flex;align-items:flex-start;gap:12px;margin-top:8px}
  .qr-img{width:65px;height:65px}
  .arca-block{display:flex;flex-direction:column;justify-content:center}
  .arca-logo{width:120px;height:44px}
  .arca-sub{font-size:8pt;margin-top:2px}
  .arca-disclaimer{font-size:6.5pt;line-height:1.3;margin-top:3px}
  .cae-line{font-size:8.5pt;font-weight:bold;margin-top:6px}
  .observations{font-size:6.5pt;font-style:italic;color:#333;margin-top:3px}
`;
