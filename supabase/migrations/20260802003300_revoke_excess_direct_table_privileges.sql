-- ImobFlux Sprint 25: enforce least-privilege table ACLs after the
-- historical read-state and financial grants.
--
-- conversation_read_states is read directly by authenticated read models and
-- Realtime policies, while all mutations go through mark_conversation_unread.
-- opportunity_financials is read by SECURITY INVOKER read models, while all
-- writes go through the approved SECURITY DEFINER opportunity RPCs.

revoke all privileges on table public.conversation_read_states
from public, anon, authenticated, service_role;

grant select on table public.conversation_read_states
to authenticated;

revoke all privileges on table public.opportunity_financials
from public, anon, authenticated, service_role;

grant select on table public.opportunity_financials
to authenticated;
