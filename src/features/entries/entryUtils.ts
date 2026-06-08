export function generateUuidV7(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  const timestamp = BigInt(Date.now());
  bytes[0] = Number((timestamp >> 40n) & 0xffn);
  bytes[1] = Number((timestamp >> 32n) & 0xffn);
  bytes[2] = Number((timestamp >> 24n) & 0xffn);
  bytes[3] = Number((timestamp >> 16n) & 0xffn);
  bytes[4] = Number((timestamp >> 8n) & 0xffn);
  bytes[5] = Number(timestamp & 0xffn);
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(
    '',
  );
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function formatDuration(enteredAt: string): string {
  const ms = Date.now() - new Date(enteredAt).getTime();
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

export function calcSuggestedAmount(
  enteredAt: string,
  leftAt: string,
  hourPrice: number,
  stayPrice: number,
  fractionPrice: number,
): number {
  const ms = new Date(leftAt).getTime() - new Date(enteredAt).getTime();
  const totalMinutes = ms / 60000;

  if (totalMinutes <= 0) return 0;

  const hours = Math.floor(totalMinutes / 60);
  const remainingMinutes = totalMinutes % 60;

  const fullHoursAmount = hours * hourPrice;
  const fractionAmount = remainingMinutes > 0 ? fractionPrice : 0;
  const total = fullHoursAmount + fractionAmount;

  // Cap at stay price if exceeded
  return Math.min(total, stayPrice);
}
