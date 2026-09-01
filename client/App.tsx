import { Outlet } from "react-router";

import { App as AppProvider } from "@superblocksteam/library";

import { EmbedProvider } from "./context/EmbedContext";
import { Toaster } from "./components/common/sonner";

export default function AppComponent() {
  return (
    <>
      {/* Do not remove the AppProvider */}
      <AppProvider className="h-full w-full">
        <EmbedProvider>
          <Outlet />
        </EmbedProvider>
      </AppProvider>
      <Toaster />
    </>
  );
}
