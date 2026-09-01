import { createBrowserRouter } from "react-router";

import { PageNotFound, RouteLoadError } from "@superblocksteam/library";

import RegisteredApp from "./App.js";

export const router = createBrowserRouter([
  {
    Component: RegisteredApp,
    errorElement: <RouteLoadError />,
    children: [
      {
        path: "/",
        index: true,
        lazy: () =>
          import("./pages/Home/index.js").then((mod) => {
            const Component = mod.default;
            return { Component };
          }),
      },
      {
        path: "*",
        Component: () => {
          const currentPath = window.location.pathname;
          return (
            <PageNotFound
              title="Page not found"
              errorMessage={
                currentPath === "/" ? (
                  <span>
                    The <strong>/</strong> route has been deleted from this
                    application. Please try another URL or contact your
                    developer for assistance.
                  </span>
                ) : (
                  "Content not found"
                )
              }
              hideActions={currentPath === "/"}
              buttonPath={"/"}
              buttonText={"Return to application"}
            />
          );
        },
      },
    ],
  },
]);
