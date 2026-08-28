import { useLinkCodeClient } from '@linkcode/client-core';
import type { SessionId, SessionResource } from '@linkcode/schema';
import { MAX_ATTACHMENT_BYTES, SessionResourceIdSchema } from '@linkcode/schema';
import { hostResource, listResources, removeResource, uploadSource } from '@linkcode/sdk';
import type { CurrentPlan, ResourceItem } from '@linkcode/ui';
import { readFileAsBase64, TaskResourcesPanel } from '@linkcode/ui';
import { toastManager } from 'coss-ui/components/toast';
import { useEffect } from 'foxact/use-abortable-effect';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { useTranslations } from 'use-intl';
import { useData, useMutation } from '../runtime/tayori';

function resourceItem(resource: SessionResource, localFileLabel: string): ResourceItem {
  return {
    id: resource.resourceId,
    direction: resource.direction,
    name: resource.name,
    kind: resource.kind,
    status: resource.status,
    source:
      resource.direction === 'source'
        ? resource.locator.type === 'url'
          ? new URL(resource.locator.url).hostname
          : localFileLabel
        : undefined,
    updatedAt: resource.updatedAt,
    error: resource.error,
    canOpen: resource.status === 'ready',
    canDownload: resource.direction === 'output' && resource.status === 'ready',
  };
}

function useSessionResources(sessionId: SessionId) {
  const client = useLinkCodeClient();
  const result = useData(listResources, { sessionId });
  const { mutate } = result;

  useEffect(
    (signal) =>
      client.subscribeResources((event) => {
        const eventSessionId =
          event.type === 'changed' ? event.resource.sessionId : event.sessionId;
        if (eventSessionId === sessionId && !signal.aborted) void mutate();
      }),
    [client, mutate, sessionId],
  );

  return result;
}

/** Runtime-backed adapter from the session resource data plane into the pure shared panel. */
export function RuntimeTaskResourcesPanel({
  sessionId,
  plan,
}: {
  sessionId: SessionId;
  plan?: CurrentPlan | null;
}): React.ReactNode {
  const t = useTranslations('workbench.resources');
  const { data, mutate } = useSessionResources(sessionId);
  const uploadMutation = useMutation(uploadSource);
  const removeMutation = useMutation(removeResource);
  const hostMutation = useMutation(hostResource);

  function reportError(error: unknown): void {
    toastManager.add({
      title: extractErrorMessage(error) ?? t('operationFailed'),
      type: 'error',
    });
  }

  async function addSources(files: File[]): Promise<void> {
    for (const file of files) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        toastManager.add({ title: t('tooLarge', { name: file.name }), type: 'error' });
        continue;
      }
      try {
        const data = await readFileAsBase64(file);
        await uploadMutation.trigger({
          sessionId,
          name: file.name,
          data,
          mimeType: file.type || undefined,
        });
      } catch (error) {
        reportError(error);
      }
    }
    await mutate();
  }

  async function resourceUrl(resource: ResourceItem): Promise<string> {
    const hosted = await hostMutation.trigger({
      resourceId: SessionResourceIdSchema.parse(resource.id),
    });
    return hosted.url;
  }

  function open(resource: ResourceItem): void {
    void resourceUrl(resource)
      .then((url) => window.open(url, '_blank', 'noopener,noreferrer'))
      .catch(reportError);
  }

  function download(resource: ResourceItem): void {
    void resourceUrl(resource)
      .then((url) => {
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = resource.name;
        anchor.click();
      })
      .catch(reportError);
  }

  function remove(resource: ResourceItem): void {
    removeMutation
      .trigger({ resourceId: SessionResourceIdSchema.parse(resource.id) })
      .then(() => mutate())
      .catch(reportError);
  }

  return (
    <TaskResourcesPanel
      plan={plan}
      resources={(data ?? []).map((resource) => resourceItem(resource, t('localFile')))}
      onAddSource={(files) => {
        void addSources(files);
      }}
      onOpen={open}
      onDownload={download}
      onRemove={remove}
    />
  );
}
