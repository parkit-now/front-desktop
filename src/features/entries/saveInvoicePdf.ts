/** Render the fiscal document in Electron and offer Save as PDF. */
export async function saveInvoicePdf(
  fileName: string,
  html: string,
): Promise<string | null> {
  const desktop = window.parkitDesktop;
  if (!desktop?.renderPdf || !desktop.saveFile) {
    const preview = window.open('', '_blank');
    if (!preview) throw new Error('popup-blocked');
    preview.document.write(html);
    preview.document.close();
    preview.print();
    return null;
  }
  const pdf = await desktop.renderPdf({ html });
  if (!pdf.ok) throw new Error(pdf.detail ?? pdf.reason);
  const result = await desktop.saveFile({
    defaultName: fileName,
    data: pdf.data,
  });
  if (!result.ok && result.reason === 'write-failed')
    throw new Error(result.detail ?? 'write-failed');
  return result.ok ? result.path : null;
}
