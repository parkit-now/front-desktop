import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listAudit, listDismissedLpr } from './reports';

const mock = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('./client', () => ({ apiRequest: mock.request }));

beforeEach(() => mock.request.mockReset());

describe('paginación de informes', () => {
  it('recorre las páginas de auditoría sin superar los 5000 eventos', async () => {
    mock.request.mockResolvedValue({
      items: Array.from({ length: 100 }, (_, index) => ({
        id: `item-${index}`,
      })),
      total: 8_500,
    });
    const result = await listAudit({ tenantId: 't-1', bearer: 'token' });
    expect(result.items).toHaveLength(5_000);
    expect(result.total).toBe(8_500);
    expect(mock.request).toHaveBeenCalledTimes(50);
  });

  it('pide solo descartes y aplica el período al consultar LPR', async () => {
    mock.request.mockResolvedValue({ items: [{ id: 'lpr-1' }], total: 1 });
    const result = await listDismissedLpr({
      tenantId: 't-2',
      bearer: 'token',
      firstSeenFrom: '2026-10-01T00:00:00-03:00',
      firstSeenTo: '2026-10-02T00:00:00-03:00',
    });
    expect(result.items).toHaveLength(1);
    const request = mock.request.mock.calls[0]?.[0] as { path: string };
    const url = new URL(`http://local${request.path}`);
    expect(url.searchParams.get('status')).toBe('dismissed');
    expect(url.searchParams.get('firstSeenFrom')).toBe(
      '2026-10-01T00:00:00-03:00',
    );
    expect(url.searchParams.get('firstSeenTo')).toBe(
      '2026-10-02T00:00:00-03:00',
    );
  });
});
