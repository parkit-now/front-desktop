import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  SaveTableTemplateInput,
  TableTemplateScope,
  TableViewTemplate,
} from './definitions';
import {
  deleteTableTemplate,
  overwriteTableTemplate,
  readTableTemplateCollection,
  saveTableTemplate,
  setLastUsedTableTemplate,
  updateTableTemplateMetadata,
} from './storage';

export function useTableViewTemplates(scope: TableTemplateScope | undefined) {
  const [templates, setTemplates] = useState<TableViewTemplate[]>([]);
  const [lastUsedTemplateId, setLastUsedTemplateIdState] = useState<
    string | null
  >(null);

  const storageKey = useMemo(() => {
    if (!scope) return null;
    return `${scope.userId}:${scope.tenantId}:${scope.tableKey}`;
  }, [scope]);

  const refresh = useCallback(() => {
    if (!scope) {
      setTemplates([]);
      setLastUsedTemplateIdState(null);
      return;
    }

    const collection = readTableTemplateCollection(scope);
    setTemplates(collection.templates);
    setLastUsedTemplateIdState(collection.lastUsedTemplateId);
  }, [scope]);

  useEffect(() => {
    refresh();
  }, [refresh, storageKey]);

  const save = useCallback(
    (input: SaveTableTemplateInput) => {
      if (!scope) return null;
      const template = saveTableTemplate(scope, input);
      refresh();
      return template;
    },
    [refresh, scope],
  );

  const overwrite = useCallback(
    (templateId: string, config: SaveTableTemplateInput['config']) => {
      if (!scope) return null;
      const template = overwriteTableTemplate(scope, templateId, config);
      refresh();
      return template;
    },
    [refresh, scope],
  );

  const remove = useCallback(
    (templateId: string) => {
      if (!scope) return;
      deleteTableTemplate(scope, templateId);
      refresh();
    },
    [refresh, scope],
  );

  const updateMetadata = useCallback(
    (templateId: string, input: { name: string; description?: string }) => {
      if (!scope) return null;
      const template = updateTableTemplateMetadata(scope, templateId, input);
      refresh();
      return template;
    },
    [refresh, scope],
  );

  const setLastUsed = useCallback(
    (templateId: string | null) => {
      if (!scope) return;
      setLastUsedTableTemplate(scope, templateId);
      setLastUsedTemplateIdState(templateId);
    },
    [scope],
  );

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
  };
}
