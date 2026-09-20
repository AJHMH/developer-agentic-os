"use client";

import type { CSSProperties } from "react";
import { useCommandCentreState } from "./use-command-centre-state";
import { OrbitalStage } from "./orbit/orbital-stage";
import { NodeInspector } from "./orbit/node-inspector";
import { HeaderBar } from "./rails/header-bar";
import { LeftRail } from "./rails/left-rail";
import { RightRail } from "./rails/right-rail";
import { LayoutModal } from "./modals/layout-modal";
import { SkillConfigModal } from "./modals/skill-config-modal";
import { WorkItemInspector } from "./modals/work-item-inspector";
import { SignalInspector } from "./modals/signal-inspector";
import { OperationalRunInspector } from "./modals/operational-run-inspector";
import { OperationalIncidentInspector } from "./modals/operational-incident-inspector";
import { HandoffInspector } from "./modals/handoff-inspector";
import { SecondBrainModal } from "./micro-apps/second-brain-modal";

export function CommandCentreShell() {
  const s = useCommandCentreState();

  return (
    <main
      className={`app-shell ${s.leftRailOpen ? "" : "left-rail-collapsed"} ${s.rightRailOpen ? "" : "right-rail-collapsed"}`}
      aria-label="Developer Agentic OS dashboard"
      style={
        {
          "--app-max-width": `${s.layout.pageWidth}px`,
          "--orbit-size": `${s.layout.orbitSize}px`,
        } as CSSProperties
      }
    >
      <LeftRail
        layout={s.layout}
        resizeRef={s.resizeRef}
        markResizeStart={s.markResizeStart}
        workspaceSwitcherOpen={s.workspaceSwitcherOpen}
        setWorkspaceSwitcherOpen={s.setWorkspaceSwitcherOpen}
        focusBoardOpen={s.focusBoardOpen}
        setFocusBoardOpen={s.setFocusBoardOpen}
        secondBrainOpen={s.secondBrainOpen}
        setSecondBrainOpen={s.setSecondBrainOpen}
        secondBrainModalOpen={s.secondBrainModalOpen}
        setSecondBrainModalOpen={s.setSecondBrainModalOpen}
        secondBrainSearch={s.secondBrainSearch}
        setSecondBrainSearch={s.setSecondBrainSearch}
        secondBrainTypeFilter={s.secondBrainTypeFilter}
        setSecondBrainTypeFilter={s.setSecondBrainTypeFilter}
        filteredGraphNodes={s.filteredGraphNodes}
        selectedNode={s.selectedNode}
        handoffOpen={s.handoffOpen}
        setHandoffOpen={s.setHandoffOpen}
        workspace={s.workspace}
        workspaceLoading={s.workspaceLoading}
        workspaceError={s.workspaceError}
        onSwitchRepository={(id) => void s.switchRepository(id)}
        handoffs={s.handoffs}
        handoffTitle={s.handoffTitle}
        setHandoffTitle={s.setHandoffTitle}
        handoffDecisions={s.handoffDecisions}
        setHandoffDecisions={s.setHandoffDecisions}
        handoffBlockers={s.handoffBlockers}
        setHandoffBlockers={s.setHandoffBlockers}
        handoffNextActions={s.handoffNextActions}
        setHandoffNextActions={s.setHandoffNextActions}
        onCreateHandoff={(e) => void s.createHandoff(e)}
        onSelectHandoff={s.selectHandoff}
        graph={s.graph}
        dashboard={s.dashboard}
        dashboardLoading={s.dashboardLoading}
        onInspectNode={s.inspectNode}
        onRefreshSecondBrain={() => void s.loadDashboard(s.workspace?.context.id)}
      />

      <section className="core" aria-label="Central workspace graph">
        <HeaderBar
          leftRailOpen={s.leftRailOpen}
          setLeftRailOpen={s.setLeftRailOpen}
          rightRailOpen={s.rightRailOpen}
          setRightRailOpen={s.setRightRailOpen}
          integrationOpen={s.integrationOpen}
          setIntegrationOpen={s.setIntegrationOpen}
          onOpenLayout={() => s.setLayoutOpen(true)}
          dashboard={s.dashboard}
          dashboardLoading={s.dashboardLoading}
          dashboardError={s.dashboardError}
          actionStatus={s.actionStatus}
          githubOperations={s.githubOperations}
          githubOperationsLoading={s.githubOperationsLoading}
          vercelOperations={s.vercelOperations}
          vercelOperationsLoading={s.vercelOperationsLoading}
          onRefreshIntegrations={() => {
            void s.loadDashboard(s.workspace?.context.id);
            if (s.workspace?.context.id) {
              void s.loadGitHubOperations(s.workspace.context.id);
              void s.loadVercelOperations(s.workspace.context.id);
            }
          }}
        />
        <OrbitalStage
          secondBrainOpen={s.secondBrainOpen}
          renderOrbitSize={s.renderOrbitSize}
          orbitRef={s.orbitRef}
          graph={s.graph}
          graphNodes={s.graphNodes}
          onInspectNode={s.inspectNode}
        />
      </section>

      <RightRail
        layout={s.layout}
        resizeRef={s.resizeRef}
        markResizeStart={s.markResizeStart}
        workspace={s.workspace}
        dashboard={s.dashboard}
        dashboardLoading={s.dashboardLoading}
        workItems={s.workItems}
        workItemTitle={s.workItemTitle}
        setWorkItemTitle={s.setWorkItemTitle}
        workItemNotes={s.workItemNotes}
        setWorkItemNotes={s.setWorkItemNotes}
        workItemDueAt={s.workItemDueAt}
        setWorkItemDueAt={s.setWorkItemDueAt}
        workItemReferences={s.workItemReferences}
        setWorkItemReferences={s.setWorkItemReferences}
        workItemPriority={s.workItemPriority}
        setWorkItemPriority={s.setWorkItemPriority}
        workItemRepositoryFilter={s.workItemRepositoryFilter}
        setWorkItemRepositoryFilter={s.setWorkItemRepositoryFilter}
        workItemStatusFilter={s.workItemStatusFilter}
        setWorkItemStatusFilter={s.setWorkItemStatusFilter}
        onCreateWorkItem={(e) => void s.createWorkItem(e)}
        onSelectWorkItem={s.setSelectedWorkItem}
        focusBoardOpen={s.focusBoardOpen}
        globalOperationalPaused={s.globalOperationalPaused}
        onToggleGlobalOperationalPause={() =>
          void s.setGlobalOperationalPause(!s.globalOperationalPaused)
        }
        onInspectOperationalIncident={s.setSelectedOperationalIncident}
        onInspectOperationalRun={(run) => void s.inspectOperationalRun(run)}
        onInspectNode={s.inspectNode}
        onRunSkill={(id) => void s.runSkill(id)}
        onRunRoutine={(id) => void s.runRoutine(id)}
        signals={s.signals}
        signalTitle={s.signalTitle}
        setSignalTitle={s.setSignalTitle}
        signalBody={s.signalBody}
        setSignalBody={s.setSignalBody}
        signalSource={s.signalSource}
        setSignalSource={s.setSignalSource}
        signalSourceFilter={s.signalSourceFilter}
        setSignalSourceFilter={s.setSignalSourceFilter}
        signalStatusFilter={s.signalStatusFilter}
        setSignalStatusFilter={s.setSignalStatusFilter}
        onCreateSignal={(e) => void s.createSignal(e)}
        onSelectSignal={s.setSelectedSignal}
        onConfigureSkill={s.setConfiguredSkill}
        onControlExecutor={(a) => void s.controlExecutor(a)}
      />

      {s.layoutOpen ? (
        <LayoutModal
          layout={s.layout}
          onClose={() => s.setLayoutOpen(false)}
          setPageWidth={s.setPageWidth}
          setOrbitSize={s.setOrbitSize}
          resetLayout={s.resetLayout}
        />
      ) : null}

      {s.configuredSkill ? (
        <SkillConfigModal
          configuredSkill={s.configuredSkill}
          onClose={() => s.setConfiguredSkill(null)}
          onSaveConfig={s.setConfiguredSkill}
        />
      ) : null}

      {s.selectedNode ? (
        <NodeInspector
          selectedNode={s.selectedNode}
          onClose={() => s.setSelectedNode(null)}
          artifactContent={s.artifactContent}
          inspectorStatus={s.inspectorStatus}
          onOpenArtifact={() => void s.openInspectedArtifact()}
          onRunSkill={() => void s.runSkill(s.selectedNode!.id.replace("skill:", ""))}
          onRunRoutine={(id) => void s.runRoutine(id)}
          onNavigateNode={() => void s.navigateInspectedNode()}
          onCopyPath={() => {
            if (s.selectedNode?.path) {
              void navigator.clipboard.writeText(s.selectedNode.path);
              s.setInspectorStatus("Path copied.");
            }
          }}
        />
      ) : null}

      {s.selectedWorkItem ? (
        <WorkItemInspector
          selectedWorkItem={s.selectedWorkItem}
          onClose={() => s.setSelectedWorkItem(null)}
          onUpdateStatus={(item, status) => void s.updateWorkItemStatus(item, status)}
        />
      ) : null}

      {s.selectedOperationalRun ? (
        <OperationalRunInspector
          selectedOperationalRun={s.selectedOperationalRun}
          selectedOperationalAudit={s.selectedOperationalAudit}
          inspectorStatus={s.inspectorStatus}
          onClose={() => s.setSelectedOperationalRun(null)}
          onUpdateRun={(run, action) => void s.updateOperationalRun(run, action)}
          onInvokeAction={(run) => void s.invokeOperationalAction(run)}
        />
      ) : null}

      {s.selectedOperationalIncident ? (
        <OperationalIncidentInspector
          selectedOperationalIncident={s.selectedOperationalIncident}
          workspace={s.workspace}
          signals={s.signals}
          onClose={() => s.setSelectedOperationalIncident(null)}
        />
      ) : null}

      {s.selectedSignal ? (
        <SignalInspector
          selectedSignal={s.selectedSignal}
          onClose={() => s.setSelectedSignal(null)}
          workItems={s.workItems}
          skills={s.dashboard.skills}
          triageTargetId={s.triageTargetId}
          setTriageTargetId={s.setTriageTargetId}
          signalTriageStatus={s.signalTriageStatus}
          onUpdateStatus={(sig, st) => void s.updateSignalStatus(sig, st)}
          onTriageSignal={(sig, act) => void s.triageSignal(sig, act)}
        />
      ) : null}

      {s.selectedHandoff ? (
        <HandoffInspector
          selectedHandoff={s.selectedHandoff}
          handoffTitle={s.handoffTitle}
          setHandoffTitle={s.setHandoffTitle}
          handoffDecisions={s.handoffDecisions}
          setHandoffDecisions={s.setHandoffDecisions}
          handoffBlockers={s.handoffBlockers}
          setHandoffBlockers={s.setHandoffBlockers}
          handoffNextActions={s.handoffNextActions}
          setHandoffNextActions={s.setHandoffNextActions}
          handoffStatus={s.handoffStatus}
          onClose={() => s.setSelectedHandoff(null)}
          onSaveDraft={() => void s.saveHandoff()}
          onFinalize={() => void s.finalizeHandoff()}
        />
      ) : null}

      {s.secondBrainModalOpen ? (
        <SecondBrainModal
          isOpen={s.secondBrainModalOpen}
          onClose={() => s.setSecondBrainModalOpen(false)}
          graph={s.graph}
          workspace={s.workspace}
          onInspectNode={s.inspectNode}
          onSelectWorkItem={s.setSelectedWorkItem}
          onSelectSignal={s.setSelectedSignal}
          onOpenArtifact={() => void s.openInspectedArtifact()}
          onRunSkill={(id) => void s.runSkill(id)}
          onRunRoutine={(id) => void s.runRoutine(id)}
          workItems={s.workItems}
          signals={s.signals}
          onRefresh={() => void s.loadDashboard(s.workspace?.context.id)}
        />
      ) : null}
    </main>
  );
}
