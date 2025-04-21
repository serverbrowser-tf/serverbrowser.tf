import { Request, Response } from "express";

export const isDev = !!process.env.DEV

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function asyncify<
  Req extends Request = Request,
  Res extends Response = Response,
>(fn: (req: Req, res: Res) => Promise<void>) {
  return function(req: Req, res: Res) {
    fn(req, res).catch((e) => {
      console.error("asyncify", e);
      res.status(500).end();
    });
  };
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

export function assert(value: boolean, error: string): asserts value {
  if (!value) {
    throw new Error(error);
  }
}

export async function scheduleDaily(
  taskFn: () => Promise<void>,
): Promise<void> {
  while (true) {
    const now = new Date();
    const est = new Date(
      now.toLocaleString("en-US", { timeZone: "America/New_York" }),
    );
    const target = new Date(est);
    target.setHours(6, 0, 0, 0);

    if (est > target) {
      target.setDate(target.getDate() + 1);
    }

    const msUntilTarget = target.getTime() - est.getTime();
    await sleep(msUntilTarget);
    await taskFn();
  }
}

export function makeAsyncIterator<T>() {
  const values: T[] = [];
  let done = false;
  let p = Promise.withResolvers<void>();
  return {
    done() {
      done = true;
      p.resolve();
      p = Promise.withResolvers<void>();
    },
    push(value: T) {
      console.assert(!done, "we said we were done but we still pushing");
      values.push(value);
      p.resolve();
      p = Promise.withResolvers<void>();
    },
    [Symbol.asyncIterator](): AsyncIterator<T> {
      let i = 0;
      return {
        async next() {
          if (i >= values.length && !done) {
            await p.promise;
          }
          if (i < values.length) {
            i += 1;
            return {
              done: false,
              value: values[i - 1],
            };
          }
          return {
            done: true,
            value: undefined,
          };
        },
      };
    },
  };
}

