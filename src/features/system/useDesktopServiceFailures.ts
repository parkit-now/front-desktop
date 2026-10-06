import { useEffect, useState } from 'react';

export type DesktopServiceName = 'lpr-service' | 'camera-service';

const KNOWN_DESKTOP_SERVICES = new Set<DesktopServiceName>([
  'lpr-service',
  'camera-service',
]);

function isDesktopServiceName(name: string): name is DesktopServiceName {
  return KNOWN_DESKTOP_SERVICES.has(name as DesktopServiceName);
}

export function normalizeDesktopServiceFailures(
  names: readonly string[],
): DesktopServiceName[] {
  const normalized: DesktopServiceName[] = [];
  for (const name of names) {
    if (!isDesktopServiceName(name) || normalized.includes(name)) continue;
    normalized.push(name);
  }
  return normalized;
}

export function mergeDesktopServiceFailures(
  current: readonly DesktopServiceName[],
  incoming: readonly string[],
): DesktopServiceName[] {
  const merged = [...current];
  for (const name of normalizeDesktopServiceFailures(incoming)) {
    if (!merged.includes(name)) merged.push(name);
  }
  return merged;
}

export function hasDesktopServiceFailure(
  failedServices: readonly DesktopServiceName[],
  name: DesktopServiceName,
): boolean {
  return failedServices.includes(name);
}

export function useDesktopServiceFailures(): DesktopServiceName[] {
  const [failedServices, setFailedServices] = useState<DesktopServiceName[]>(
    [],
  );

  useEffect(() => {
    const bridge = window.parkitDesktop;
    if (!bridge) return undefined;

    let mounted = true;

    void bridge
      .getFailedServices()
      .then((names) => {
        if (!mounted) return;
        setFailedServices(normalizeDesktopServiceFailures(names));
      })
      .catch(() => undefined);

    bridge.onServicesFailed((names) => {
      if (!mounted) return;
      setFailedServices((current) =>
        mergeDesktopServiceFailures(current, names),
      );
    });

    const unsubscribeCrash = bridge.onServiceCrashed((name) => {
      if (!mounted) return;
      setFailedServices((current) =>
        mergeDesktopServiceFailures(current, [name]),
      );
    });
    const unsubscribeRecovered =
      typeof bridge.onServiceRecovered === 'function'
        ? bridge.onServiceRecovered((name) => {
            if (!mounted) return;
            const [serviceName] = normalizeDesktopServiceFailures([name]);
            if (!serviceName) return;
            setFailedServices((current) =>
              current.filter((failed) => failed !== serviceName),
            );
          })
        : () => undefined;

    return () => {
      mounted = false;
      unsubscribeCrash();
      unsubscribeRecovered();
    };
  }, []);

  return failedServices;
}
