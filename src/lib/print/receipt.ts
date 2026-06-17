export interface ReceiptData {
  plate: string;
  ticketNumber?: number;
  amountDue: number;
  received?: number;
  change?: number;
  paymentMethodName: string;
  leftAt: string;
}

// TODO(US021): replace this placeholder with real receipt printing.
export function printReceipt(data: ReceiptData): void {
  console.info('[comprobante] imprimiendo comprobante', data);
}
