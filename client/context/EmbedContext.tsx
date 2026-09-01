import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import {
  useEmbedProperties,
  useSuperblocksDataTags,
} from "@superblocksteam/library";

interface EmbedContextValue {
  airboardToken: string | null;
  profile: string | null;
  isStaging: boolean;
}

const EmbedContext = createContext<EmbedContextValue>({
  airboardToken: null,
  profile: null,
  isStaging: false,
});

export function useEmbed(): EmbedContextValue {
  return useContext(EmbedContext);
}

export function EmbedProvider({ children }: { children: ReactNode }) {
  const properties = useEmbedProperties();
  const { setDataTag } = useSuperblocksDataTags();

  const airboardToken = (properties?.airboardToken as string) ?? null;
  const profile = (properties?.profile as string) ?? null;
  const isStaging = profile?.startsWith("staging") ?? false;

  // Set active data tag from profile on mount
  useEffect(() => {
    if (profile) {
      // Convert profile value to data tag key (e.g. "staging-sg" → "staging_sg")
      const tagKey = profile.replace(/-/g, "_");
      setDataTag(tagKey);
    }
  }, [profile, setDataTag]);

  const value = useMemo(
    () => ({ airboardToken, profile, isStaging }),
    [airboardToken, profile, isStaging],
  );

  return (
    <EmbedContext.Provider value={value}>{children}</EmbedContext.Provider>
  );
}
