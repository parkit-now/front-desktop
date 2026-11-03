import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { LocalTableTemplate } from '../../lib/db/localDb';
import { useNetwork } from '../../lib/network/NetworkContext';
import { translateApiError } from '../../lib/api/translate';
import { syncService } from '../../lib/sync/SyncService';
import type { SaveTableTemplateInput, TableTemplateScope } from './definitions';
import {
  readTableTemplateCollection,
  setLastUsedTableTemplate,
  writeCollection,
} from './storage';
import {
  deleteLocalTemplate,
  ensureTemplateScope,
  pullTemplateScope,
  readLocalTemplates,
  saveLocalTemplate,
  templateScopeKey,
} from './repository';

export function useTableViewTemplates(
  inputScope: TableTemplateScope | undefined,
) {
  const { userId, tenantId, tableKey } = inputScope ?? {};
  const scope = useMemo(
    () =>
      userId && tenantId && tableKey
        ? { userId, tenantId, tableKey }
        : undefined,
    [userId, tenantId, tableKey],
  );
  const { isOnline } = useNetwork();
  const key = scope ? templateScopeKey(scope) : '';
  const currentKey = useRef(key);
  currentKey.current = key;
  const [readyKey, setReadyKey] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUsedTemplateId, setLastUsedTemplateIdState] = useState<
    string | null
  >(null);
  const rows = useLiveQuery<LocalTableTemplate[]>(
    () => (scope ? readLocalTemplates(scope) : Promise.resolve([])),
    [key],
  );
  const loading = !!scope && (readyKey !== key || rows === undefined);
  const templates = useMemo(
    () => (loading ? [] : (rows ?? []).filter((row) => !row.deletedAt)),
    [rows, loading],
  );

  const refresh = useCallback(async () => {
    if (!scope) return;
    const capturedKey = templateScopeKey(scope);
    try {
      await ensureTemplateScope(scope);
      if (currentKey.current !== capturedKey) return;
      setReadyKey(capturedKey);
      if (!isOnline) return;
      const { getSession } = await import('../../lib/supabase/session');
      const session = await getSession();
      if (
        !session ||
        session.user.id !== scope.userId ||
        currentKey.current !== capturedKey
      )
        return;
      syncService.setCredentials(
        scope.tenantId,
        session.access_token,
        scope.userId,
      );
      await syncService.pushPendingOps(false, 'tableTemplate');
      await pullTemplateScope(scope, session.access_token);
    } catch (cause) {
      if (currentKey.current === capturedKey)
        setError(translateApiError(cause));
    }
  }, [scope, isOnline]);

  useEffect(() => {
    setReadyKey('');
    setError(null);
    setLastUsedTemplateIdState(
      scope ? readTableTemplateCollection(scope).lastUsedTemplateId : null,
    );
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [key, refresh]);

  useEffect(() => {
    if (!scope || loading) return;
    const collection = readTableTemplateCollection(scope);
    const lastUsed = templates.some(
      (t) => t.id === collection.lastUsedTemplateId,
    )
      ? collection.lastUsedTemplateId
      : null;
    writeCollection(scope, {
      version: 1,
      templates,
      lastUsedTemplateId: lastUsed,
    });
    setLastUsedTemplateIdState(lastUsed);
  }, [scope, templates, loading]);

  const mutate = useCallback(
    async <T>(action: () => Promise<T>): Promise<T | null> => {
      if (busyRef.current) return null;
      const capturedKey = key;
      busyRef.current = true;
      setBusy(true);
      setError(null);
      try {
        const result = await action();
        void refresh();
        return currentKey.current === capturedKey ? result : null;
      } catch (cause) {
        if (currentKey.current === capturedKey)
          setError(translateApiError(cause));
        return null;
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [key, refresh],
  );

  const save = (input: SaveTableTemplateInput) =>
    scope
      ? mutate(() => saveLocalTemplate(scope, input))
      : Promise.resolve(null);
  const overwrite = (id: string, config: SaveTableTemplateInput['config']) => {
    const existing = templates.find((t) => t.id === id);
    return scope && existing
      ? mutate(() => saveLocalTemplate(scope, { ...existing, config }, id))
      : Promise.resolve(null);
  };
  const updateMetadata = (
    id: string,
    input: { name: string; description?: string },
  ) => {
    const existing = templates.find((t) => t.id === id);
    return scope && existing
      ? mutate(() => saveLocalTemplate(scope, { ...existing, ...input }, id))
      : Promise.resolve(null);
  };
  const remove = (id: string) =>
    scope
      ? mutate(async () => {
          await deleteLocalTemplate(scope, id);
          return true;
        })
      : Promise.resolve(null);
  const setLastUsed = (id: string | null) => {
    if (!scope) return;
    setLastUsedTableTemplate(scope, id);
    setLastUsedTemplateIdState(id);
  };
  return {
    enabled: Boolean(scope),
    templates,
    lastUsedTemplateId,
    refresh,
    save,
    overwrite,
    remove,
    updateMetadata,
    setLastUsed,
    loading,
    busy,
    error,
    canWrite: !loading && !busy,
  };
}
