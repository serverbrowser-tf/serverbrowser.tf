import { DependencyList, useEffect, useState, MutableRefObject } from "react";
import { assert, geoIpAtom, logout, useAtom } from "./globals.ts";

export let apiRoute = "";

const _api = async (
  url: string,
  init?: Omit<RequestInit, "body"> & { body?: any },
): Promise<Response> => {
  if (init?.body && typeof init.body !== "string") {
    init.body = JSON.stringify(init.body);
    init.headers = init.headers || {};
    if (init.headers instanceof Headers) {
      init.headers.set("Content-Type", "application/json");
    } else if (Array.isArray(init.headers)) {
      init.headers.push(["Content-Type", "application/json"]);
    } else {
      init.headers["Content-Type"] = "application/json";
    }
  }

  const fetched = await fetch(url, init);
  if (!fetched.ok) {
    if (fetched.status === 401) {
      logout();
    }
    console.error(fetched.status, fetched.statusText);
    throw new Error(fetched.statusText);
  }

  return fetched;
};

export const api = async <T = any>(
  url: string,
  init?: Omit<RequestInit, "body"> & { body?: any },
): Promise<T> => {
  const resp = await _api(url, init);
  return resp.json();
};

export async function* apiLines<T = any>(
  url: string,
  init?: Omit<RequestInit, "body"> & { body?: any },
): AsyncGenerator<T> {
  const resp = await _api(url, init);
  const contentType = resp.headers.get("Content-Type");
  if (contentType === "application/json") {
    console.error("Expecting jsonlines but got json");
    return resp.json();
  }
  assert(contentType === "application/jsonl");
  assert(resp.body != null);

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        // Process any remaining data in buffer
        if (buffer.trim()) {
          yield JSON.parse(buffer.trim());
        }
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");

      // Process all complete lines
      for (let i = 0; i < lines.length - 1; i++) {
        const line = lines[i].trim();
        if (line) {
          yield JSON.parse(line);
        }
      }

      // Keep the last incomplete line in buffer
      buffer = lines[lines.length - 1];
    }
  } finally {
    reader.releaseLock();
  }
}

type EffectFn = (signal: AbortSignal) => void | Promise<void>;

export const useSignalEffect = (fn: EffectFn, deps?: DependencyList) => {
  useEffect(() => {
    const controller = new AbortController();

    fn(controller.signal);

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
};

export const useGeoIp = () => {
  useEffect(() => {
    main();
    async function main() {
      if (geoIpAtom.value !== undefined) {
        return geoIpAtom.value;
      }

      const result = await api<{
        success: boolean;
        long: number | null;
        lat: number | null;
      }>("/api/location");

      if (result.success && result.long != null && result.lat != null) {
        geoIpAtom.value = [result.long, result.lat];
      } else {
        geoIpAtom.value = null;
      }
    }
  }, []);
  return useAtom(geoIpAtom);
};

export function calculateLongLatDistance(
  point1: [number, number],
  point2: [number, number],
): number {
  const R = 3959; // Earth's radius in miles
  const [lat1, lon1] = point1.map((deg) => (deg * Math.PI) / 180);
  const [lat2, lon2] = point2.map((deg) => (deg * Math.PI) / 180);

  const dLat = lat2 - lat1;
  const dLon = lon2 - lon1;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

interface MapUpsertOptions<K, T> {
  insert?: (key: K, self: Map<K, T>) => T;
  update?: (old: T, key: K, self: Map<K, T>) => T;
}

export function mapUpsert<K, T, Options extends MapUpsertOptions<K, T>>(
  map: Map<K, T>,
  key: K,
  options: Options,
): Options["insert"] extends Function ? T : T | undefined {
  if (map.has(key)) {
    const oldValue = map.get(key);
    if (options.update) {
      const newValue = options.update(oldValue!, key, map);
      map.set(key, newValue);
      return newValue;
    }
    return oldValue!;
  } else {
    if (options.insert) {
      const newValue = options.insert(key, map);
      map.set(key, newValue);
      return newValue;
    }
    return undefined as any;
  }
}

export const clamp = (value: number, min: number, max: number) => {
  return Math.min(Math.max(value, min), max);
};

export const lerp = (a: number, b: number, t: number) => {
  return a + t * (b - a);
};

type Point = { x: number; y: number };

export const weightedBezier = (a: Point, b: Point, c: Point, x: number) => {
  const percentOf1 = (x - a.x) / (b.x - a.x);
  const percentOf2 = (x - b.x) / (c.x - b.x);
  const lerped1 = lerp(a.y, b.y, percentOf1);
  const lerped2 = lerp(b.y, c.y, percentOf2);

  let t: number;
  if (x <= b.x) {
    t = percentOf1 / 2;
  } else {
    t = percentOf2 / 2 + 0.5;
  }
  return lerp(lerped1, lerped2, t);
};

export function getPingScore(x: number): number {
  const points: [Point, Point, Point] = [
    { x: 5, y: 1 },
    { x: 120, y: 0 },
    { x: 330, y: -1 },
  ];
  if (x <= points[0].x) {
    return points[0].y;
  }
  if (x >= points[2].x) {
    return points[2].y;
  }

  for (let i = 0; i < points.length - 1; i++) {
    let curr = points[i];
    let next = points[i + 1];
    if (curr.x <= x && x <= next.x) {
      return lerp(curr.y, next.y, (x - curr.x) / (next.x - curr.x));
    }
  }
  return 0;
}

export function getPlayerScore(x: number): number {
  const points: [Point, Point, Point, Point] = [
    { x: 0, y: -10 },
    { x: 1, y: 0 },
    { x: 12, y: 0.8 },
    { x: 24, y: 1 },
  ];
  if (x <= points[0].x) {
    return points[0].y;
  }
  if (x >= points[3].x) {
    return points[3].y;
  }

  for (let i = 0; i < points.length - 1; i++) {
    let curr = points[i];
    let next = points[i + 1];
    if (curr.x <= x && x <= next.x) {
      return lerp(curr.y, next.y, (x - curr.x) / (next.x - curr.x));
    }
  }

  return 0;
}

interface Dimensions {
  width: number;
  height: number;
}

export function useElementSize(ref: MutableRefObject<HTMLElement>): Dimensions {
  const [dimensions, setDimensions] = useState<Dimensions>({
    width: 0,
    height: 0,
  });

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const updateDimensions = () => {
      const { width, height } = element.getBoundingClientRect();
      setDimensions({ width, height });
    };

    updateDimensions();

    const resizeObserver = new ResizeObserver(updateDimensions);
    resizeObserver.observe(element);

    return () => {
      resizeObserver.disconnect();
    };
  }, [ref]);

  return dimensions;
}
