import { AppShell } from "../../components/app-shell";
import { TrainingPlanDetail } from "../../components/training-plan-detail";
import { isConversationId } from "../../../src/chat/chat-import";
import { planDate } from "../../../src/domain/training-plan";

export default async function PlanPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ version?: string; conversation?: string; date?: string }> }) {
  const { id } = await params, query = await searchParams;
  const version = query.version && /^\d+$/.test(query.version) && Number.isSafeInteger(Number(query.version)) ? Number(query.version) : undefined;
  return <AppShell showNav={false}><TrainingPlanDetail planId={id} requestedVersion={version} conversationId={isConversationId(query.conversation) ? query.conversation : undefined} date={planDate(query.date) ? query.date : undefined} /></AppShell>;
}
