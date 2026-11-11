import { useCallback } from "react";

import { useNxs } from "../context/NxsProvider";
import {
  translateNxs,
  type NxsStringKey,
  type NxsStringValues,
  type NxsTranslator,
} from "./catalog";

export function useNxsText(): NxsTranslator {
  const { localeMode } = useNxs();

  return useCallback(
    (key: NxsStringKey, values?: NxsStringValues) =>
      translateNxs(key, localeMode, values),
    [localeMode],
  );
}
