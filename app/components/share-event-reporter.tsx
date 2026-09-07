"use client";

import { useEffect } from "react";

import { recordDemoEvent } from "./demo-event-client";

export function ShareEventReporter({ rideId, template }: { rideId: string; template: "dark" | "light" }) {
  useEffect(() => {
    recordDemoEvent({ type: "share_previewed", rideId, template });
  }, [rideId, template]);
  return null;
}
