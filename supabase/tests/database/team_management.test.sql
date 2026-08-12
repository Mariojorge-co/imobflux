begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions, auth, pg_catalog;

select plan(31);

insert into auth.users (id, email)
values
  ('a2700000-0000-4000-8000-000000000001', 'team-owner@example.test'),
  ('a2700000-0000-4000-8000-000000000002', 'team-attendant@example.test'),
  ('a2700000-0000-4000-8000-000000000003', 'other-owner@example.test'),
  ('a2700000-0000-4000-8000-000000000004', 'invited@example.test'),
  ('a2700000-0000-4000-8000-000000000005', 'wrong@example.test'),
  ('a2700000-0000-4000-8000-000000000006', 'expired@example.test');

insert into public.workspaces (id, name, status, timezone)
values
  ('a2700001-0000-4000-8000-000000000001', 'Team Workspace', 'active', 'America/Maceio'),
  ('a2700001-0000-4000-8000-000000000002', 'Other Team Workspace', 'active', 'America/Maceio');

insert into public.app_users (id, auth_user_id, display_name, status)
values
  ('a2700002-0000-4000-8000-000000000001', 'a2700000-0000-4000-8000-000000000001', 'Team Owner', 'active'),
  ('a2700002-0000-4000-8000-000000000002', 'a2700000-0000-4000-8000-000000000002', 'Existing Attendant', 'active'),
  ('a2700002-0000-4000-8000-000000000003', 'a2700000-0000-4000-8000-000000000003', 'Other Owner', 'active');

insert into public.app_users (id, auth_user_id, display_name, status)
values ('a2700002-0000-4000-8000-000000000006', 'a2700000-0000-4000-8000-000000000006', 'Expired Invite', 'active');

insert into public.workspace_members (
  id, workspace_id, user_id, role, status, activated_at, invited_by_member_id
)
values
  ('a2700003-0000-4000-8000-000000000001', 'a2700001-0000-4000-8000-000000000001', 'a2700002-0000-4000-8000-000000000001', 'owner', 'active', now(), null),
  ('a2700003-0000-4000-8000-000000000002', 'a2700001-0000-4000-8000-000000000001', 'a2700002-0000-4000-8000-000000000002', 'attendant', 'active', now(), 'a2700003-0000-4000-8000-000000000001'),
  ('a2700003-0000-4000-8000-000000000003', 'a2700001-0000-4000-8000-000000000002', 'a2700002-0000-4000-8000-000000000003', 'owner', 'active', now(), null);

insert into public.workspace_members (
  id, workspace_id, user_id, invited_email_normalized, role, status,
  invited_by_member_id, invited_at, invitation_expires_at, created_at, updated_at
) values (
  'a2700003-0000-4000-8000-000000000006',
  'a2700001-0000-4000-8000-000000000001',
  'a2700002-0000-4000-8000-000000000006',
  'expired@example.test', 'attendant', 'invited',
  'a2700003-0000-4000-8000-000000000001',
  now() - interval '2 hours', now() - interval '1 hour',
  now() - interval '3 hours', now() - interval '3 hours'
);

insert into public.contacts (
  id, workspace_id, display_name, classification, operational_status,
  is_protected, commercial_visible_from, created_at, updated_at
) values (
  'a2700004-0000-4000-8000-000000000001',
  'a2700001-0000-4000-8000-000000000001',
  'Visible Team Contact', 'lead', 'active', false, now() - interval '1 minute',
  now() - interval '2 minutes', now() - interval '2 minutes'
);

set local role authenticated;
set local "request.jwt.claim.sub" = 'a2700000-0000-4000-8000-000000000001';
set local "request.jwt.claim.role" = 'authenticated';

select is((select count(*) from public.get_team_members()), 3::bigint, 'OWNER lists active and pending members in its workspace');
select is((select count(*) from public.get_team_members() where email = 'other-owner@example.test'), 0::bigint, 'OWNER does not list another workspace');
select is((select member_role from public.get_team_members() where email = 'team-owner@example.test'), 'owner', 'OWNER is clearly included in the team');

select lives_ok(
  $$select public.prepare_team_invitation('Invited Person', ' Invited@Example.Test ')$$,
  'OWNER creates a normalized ATTENDANT invitation'
);
select is((select count(*) from public.workspace_members where invited_email_normalized = 'invited@example.test'), 1::bigint, 'invitation creates exactly one membership');
select is((select role from public.workspace_members where invited_email_normalized = 'invited@example.test'), 'attendant', 'new invitation is always ATTENDANT');
select throws_ok(
  $$select public.prepare_team_invitation('Duplicate', 'invited@example.test')$$,
  '23505', 'team_invitation_already_pending',
  'duplicate pending invitation is blocked'
);
select throws_ok(
  $$select public.prepare_team_invitation('Existing', 'team-attendant@example.test')$$,
  '23505', 'team_member_already_active',
  'duplicate active member is blocked'
);
select ok(exists(select 1 from public.audit_events where action = 'team.invitation_created'), 'invitation creation is audited');
select is((select count(*) from public.audit_events where metadata::text ~* '(password|token|secret)'), 0::bigint, 'audit metadata stores no password, token, or secret');

set local "request.jwt.claim.sub" = 'a2700000-0000-4000-8000-000000000002';
select is((select count(*) from public.workspace_members), 1::bigint, 'ATTENDANT RLS exposes only its own membership');
select throws_ok($$select * from public.get_team_members()$$, '42501', 'team_management_not_authorized', 'ATTENDANT cannot list team administration');
select throws_ok($$select public.prepare_team_invitation('Blocked', 'blocked@example.test')$$, '42501', 'team_management_not_authorized', 'ATTENDANT cannot invite');
select throws_ok($$select public.deactivate_team_member('a2700003-0000-4000-8000-000000000002')$$, '42501', 'team_management_not_authorized', 'ATTENDANT cannot deactivate');
select throws_ok($$select public.reactivate_team_member('a2700003-0000-4000-8000-000000000002')$$, '42501', 'team_management_not_authorized', 'ATTENDANT cannot reactivate');

reset role;
set local role service_role;
set local "request.jwt.claim.role" = 'service_role';
select throws_ok(
  $$select public.bind_team_invitation_auth_identity((select id from public.workspace_members where invited_email_normalized = 'invited@example.test'), 'a2700000-0000-4000-8000-000000000005')$$,
  '42501', 'team_invitation_identity_mismatch',
  'invitation rejects a different Auth email'
);
select lives_ok(
  $$select public.bind_team_invitation_auth_identity((select id from public.workspace_members where invited_email_normalized = 'invited@example.test'), 'a2700000-0000-4000-8000-000000000004')$$,
  'service role binds the matching Auth identity'
);

insert into public.app_users (id, display_name, status)
values ('a2700002-0000-4000-8000-000000000007', 'Cross Workspace Invite', 'active');
insert into public.workspace_members (
  id, workspace_id, user_id, invited_email_normalized, role, status,
  invited_by_member_id, invited_at, invitation_expires_at
) values (
  'a2700003-0000-4000-8000-000000000007',
  'a2700001-0000-4000-8000-000000000002',
  'a2700002-0000-4000-8000-000000000007',
  'invited@example.test', 'attendant', 'invited',
  'a2700003-0000-4000-8000-000000000003', now(), now() + interval '1 hour'
);
select throws_ok(
  $$select public.bind_team_invitation_auth_identity('a2700003-0000-4000-8000-000000000007', 'a2700000-0000-4000-8000-000000000004')$$,
  '23505', 'team_auth_identity_already_linked',
  'an invitation cannot reuse an Auth identity across workspaces'
);

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = 'a2700000-0000-4000-8000-000000000006';
select throws_ok($$select public.accept_team_invitation()$$, '22023', 'team_invitation_expired', 'expired invitation is rejected by the backend');

set local "request.jwt.claim.sub" = 'a2700000-0000-4000-8000-000000000004';
select lives_ok($$select public.accept_team_invitation()$$, 'matching invited identity accepts its invitation');
select is((select member_role from private.active_member_context()), 'attendant', 'accepted invitation activates ATTENDANT context');
select throws_ok($$select public.accept_team_invitation()$$, '42501', 'team_invitation_invalid_or_used', 'used invitation cannot be accepted again');

set local "request.jwt.claim.sub" = 'a2700000-0000-4000-8000-000000000001';
select lives_ok($$select public.deactivate_team_member((select id from public.workspace_members where invited_email_normalized = 'invited@example.test'))$$, 'OWNER deactivates ATTENDANT');
select ok(exists(select 1 from public.audit_events where action = 'team.member_deactivated'), 'deactivation is audited');

set local "request.jwt.claim.sub" = 'a2700000-0000-4000-8000-000000000004';
select is((select count(*) from private.active_member_context()), 0::bigint, 'inactive member immediately loses authorization context');
select is((select count(*) from public.contacts), 0::bigint, 'inactive member cannot recover protected workspace resources');

set local "request.jwt.claim.sub" = 'a2700000-0000-4000-8000-000000000001';
select lives_ok($$select public.reactivate_team_member((select id from public.workspace_members where invited_email_normalized = 'invited@example.test'))$$, 'OWNER reactivates the same membership');
select is((select count(*) from public.workspace_members where invited_email_normalized = 'invited@example.test'), 1::bigint, 'reactivation does not create a new membership');
select throws_ok($$select public.deactivate_team_member('a2700003-0000-4000-8000-000000000001')$$, '55000', 'team_member_not_deactivatable', 'OWNER cannot deactivate itself');
select is((select count(*) from public.workspace_members where role = 'owner' and status = 'active'), 1::bigint, 'workspace remains with its active OWNER');
select ok(exists(select 1 from public.audit_events where action = 'team.member_reactivated'), 'reactivation is audited');

select * from finish();
rollback;
