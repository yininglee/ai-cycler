"use client";

import Link from "next/link";
import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";

import { BackIcon } from "./icons";
import { recordDemoEvent } from "./demo-event-client";

type RideDetailTab = "summary" | "analysis" | "data";

type TabDefinition = {
  key: RideDetailTab;
  label: string;
};

const TABS: TabDefinition[] = [
  { key: "summary", label: "摘要" },
  { key: "analysis", label: "分析" },
  { key: "data", label: "数据" },
];

function tabFromLocation(): RideDetailTab {
  const tab = new URLSearchParams(window.location.search).get("tab");
  return tab === "analysis" || tab === "data" ? tab : "summary";
}

export function RideDetailTabs({
  initialTab,
  rideId,
  rejected,
  summaryPanel,
  analysisPanel,
  dataPanel,
}: {
  initialTab: RideDetailTab;
  rideId: string;
  rejected: boolean;
  summaryPanel: ReactNode;
  analysisPanel: ReactNode;
  dataPanel: ReactNode;
}) {
  const [fromChat, setFromChat] = useState(false);
  useEffect(() => { setFromChat(new URLSearchParams(window.location.search).get("from") === "chat"); }, []);
  const [activeTab, setActiveTab] = useState<RideDetailTab>(initialTab);
  const pageClassName = activeTab === "summary" && !rejected ? "ride-detail-page ride-detail-summary-page" : "ride-detail-page";

  useEffect(() => {
    function handlePopState() {
      setActiveTab(tabFromLocation());
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    if (activeTab === "data") recordDemoEvent({ type: "evidence_viewed", rideId });
  }, [activeTab, rideId]);

  function selectTab(tab: RideDetailTab) {
    if (tab === activeTab) return;

    setActiveTab(tab);
    const url = new URL(window.location.href);
    if (tab === "summary") {
      url.searchParams.delete("tab");
    } else {
      url.searchParams.set("tab", tab);
    }
    window.history.pushState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, tabIndex: number) {
    const nextIndex = event.key === "ArrowRight"
      ? (tabIndex + 1) % TABS.length
      : event.key === "ArrowLeft"
        ? (tabIndex - 1 + TABS.length) % TABS.length
        : event.key === "Home"
          ? 0
          : event.key === "End"
            ? TABS.length - 1
            : null;
    if (nextIndex === null) return;

    event.preventDefault();
    const nextTab = TABS[nextIndex];
    selectTab(nextTab.key);
    document.getElementById(`ride-detail-tab-${nextTab.key}`)?.focus();
  }

  return (
    <div className={pageClassName}>
      <header className="detail-nav">
        <Link className="icon-button" href={fromChat ? "/chat" : "/import"} aria-label={fromChat ? "返回原对话" : "返回选择记录"}><BackIcon /></Link>
        <nav className="detail-tabs" aria-label="骑行记录详情" role="tablist">
          {TABS.map((tab, index) => <button
            aria-controls={`ride-detail-panel-${tab.key}`}
            aria-selected={activeTab === tab.key}
            className={activeTab === tab.key ? "active" : ""}
            id={`ride-detail-tab-${tab.key}`}
            key={tab.key}
            onClick={() => selectTab(tab.key)}
            onKeyDown={(event) => handleTabKeyDown(event, index)}
            role="tab"
            tabIndex={activeTab === tab.key ? 0 : -1}
            type="button"
          >{tab.label}</button>)}
        </nav>
        <span className="nav-spacer" aria-hidden="true" />
      </header>

      <div aria-labelledby="ride-detail-tab-summary" hidden={activeTab !== "summary"} id="ride-detail-panel-summary" role="tabpanel">{summaryPanel}</div>
      <div aria-labelledby="ride-detail-tab-analysis" hidden={activeTab !== "analysis"} id="ride-detail-panel-analysis" role="tabpanel">{analysisPanel}</div>
      <div aria-labelledby="ride-detail-tab-data" hidden={activeTab !== "data"} id="ride-detail-panel-data" role="tabpanel">{dataPanel}</div>
    </div>
  );
}
