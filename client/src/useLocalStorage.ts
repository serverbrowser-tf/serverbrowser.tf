import { Dispatch, SetStateAction, useCallback, useState } from "react";

export const getLocalStorageItem = <T>(
  key: string,
  value: T | (() => T),
): T => {
  try {
    const item = localStorage.getItem(key);
    if (item != null) {
      return JSON.parse(item);
    }
  } catch {}

  return typeof value !== "function" ? value : (value as any)();
};

export const setLocalStorageItem = <T>(
  key: string,
  value: T | ((old?: T) => T),
) => {
  try {
    let valueToWrite: T;
    if (typeof value === "function") {
      const oldValue = getLocalStorageItem<T | undefined>(key, () => undefined);
      valueToWrite = (value as (old?: T) => T)(oldValue);
    } else {
      valueToWrite = value;
    }
    localStorage.setItem(key, JSON.stringify(valueToWrite));
  } catch {}
};

export const useLocalStorage = <T>(key: string, value: T | (() => T)) => {
  const [state, setState] = useState<T>(() => getLocalStorageItem(key, value));

  const setWrapper = useCallback<Dispatch<SetStateAction<T>>>(
    (input) => {
      setState(input);
      setState((old) => {
        try {
          localStorage.setItem(key, JSON.stringify(old));
        } catch {}
        return old;
      });
    },
    [key],
  );

  return [state, setWrapper] as const;
};
