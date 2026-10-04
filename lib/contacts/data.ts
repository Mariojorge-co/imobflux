import "server-only";

import { looksLikePhoneSearch, normalizeBrazilianPhone } from "@/lib/contacts/phone";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type {
  ContactClassification,
  ContactListFilters,
  ContactListResult,
  ContactOperationalStatus,
} from "@/types/contacts";

const pageSize = 20;
const classifications = new Set<ContactClassification>([
  "person",
  "lead",
  "client",
]);
const statuses = new Set<ContactOperationalStatus>(["active", "inactive"]);

type SearchParams = Record<string, string | string[] | undefined>;

function readSearchParam(searchParams: SearchParams, key: string) {
  const value = searchParams[key];
  return typeof value === "string" ? value : "";
}

export function parseContactListFilters(searchParams: SearchParams): ContactListFilters {
  const classificationValue = readSearchParam(searchParams, "classification");
  const statusValue = readSearchParam(searchParams, "status");
  const pageValue = Number.parseInt(readSearchParam(searchParams, "page"), 10);

  return {
    archived: readSearchParam(searchParams, "archived") === "true",
    classification: classifications.has(classificationValue as ContactClassification)
      ? (classificationValue as ContactClassification)
      : null,
    page: Number.isSafeInteger(pageValue) && pageValue > 0 ? pageValue : 1,
    query: readSearchParam(searchParams, "q").trim(),
    status: statuses.has(statusValue as ContactOperationalStatus)
      ? (statusValue as ContactOperationalStatus)
      : null,
  };
}

export async function getContacts(
  workspaceId: string,
  filters: ContactListFilters,
): Promise<ContactListResult> {
  const supabase = await createServerSupabaseClient();
  const normalizedPhone =
    filters.query && looksLikePhoneSearch(filters.query)
      ? normalizeBrazilianPhone(filters.query)
      : null;

  let contactIdsForPhone: string[] | null = null;

  if (normalizedPhone) {
    const { data: points, error: pointsError } = await supabase
      .from("contact_points")
      .select("contact_id")
      .eq("workspace_id", workspaceId)
      .eq("point_type", "phone")
      .eq("operational_status", "active")
      .eq("normalized_value", normalizedPhone.normalizedValue)
      .not("contact_id", "is", null);

    if (pointsError) {
      throw new Error("Não foi possível carregar os contatos.");
    }

    contactIdsForPhone = points.flatMap((point) =>
      point.contact_id ? [point.contact_id] : [],
    );
  }

  let contactsQuery = supabase
    .from("contacts")
    .select(
      "id, display_name, classification, operational_status, archived_at, is_protected",
      { count: "exact" },
    )
    .eq("workspace_id", workspaceId)
    .order("display_name", { ascending: true })
    .order("id", { ascending: true });

  contactsQuery = filters.archived
    ? contactsQuery.not("archived_at", "is", null)
    : contactsQuery.is("archived_at", null);

  if (filters.classification) {
    contactsQuery = contactsQuery.eq("classification", filters.classification);
  }

  if (filters.status) {
    contactsQuery = contactsQuery.eq("operational_status", filters.status);
  }

  if (normalizedPhone) {
    if (!contactIdsForPhone?.length) {
      return {
        contacts: [],
        page: filters.page,
        total: 0,
      };
    }

    contactsQuery = contactsQuery.in("id", contactIdsForPhone);
  } else if (filters.query) {
    contactsQuery = contactsQuery.ilike("display_name", `%${filters.query}%`);
  }

  const from = (filters.page - 1) * pageSize;
  const { count, data: contacts, error: contactsError } = await contactsQuery.range(
    from,
    from + pageSize - 1,
  );

  if (contactsError) {
    throw new Error("Não foi possível carregar os contatos.");
  }

  const contactIds = contacts.map((contact) => contact.id);
  let points: { id: string; contact_id: string | null; display_value: string | null; external_avatar_url: string | null }[] = [];

  if (contactIds.length > 0) {
    const { data, error } = await supabase
      .from("contact_points")
      .select("id, contact_id, display_value, external_avatar_url")
      .eq("workspace_id", workspaceId)
      .eq("point_type", "phone")
      .eq("operational_status", "active")
      .in("contact_id", contactIds)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });

    if (error) {
      throw new Error("Não foi possível carregar os contatos.");
    }

    points = data;
  }

  const phonesByContact = new Map<string, string[]>();
  const avatarsByContact = new Map<string, string>();
  const pointToContact = new Map<string, string>();

  for (const point of points) {
    if (point.contact_id) {
      pointToContact.set(point.id, point.contact_id);
      if (point.display_value) {
        const values = phonesByContact.get(point.contact_id) ?? [];
        values.push(point.display_value);
        phonesByContact.set(point.contact_id, values);
      }
      if (point.external_avatar_url && !avatarsByContact.has(point.contact_id)) {
        avatarsByContact.set(point.contact_id, `/api/contact-avatar/${point.id}`);
      }
    }
  }

  const conversationsByContact = new Map<string, string>();
  if (points.length > 0) {
    const pointIds = points.map((p) => p.id);
    const { data: participants, error: participantsError } = await supabase
      .from("conversation_participants")
      .select("contact_point_id, conversation_id")
      .eq("workspace_id", workspaceId)
      .in("contact_point_id", pointIds)
      .is("left_at", null);

    if (participantsError) {
      throw new Error("Não foi possível carregar as conversas dos contatos.");
    }

    const conversationIds = [
      ...new Set(
        (participants ?? [])
          .map((participant) => participant.conversation_id)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const { data: conversations, error: conversationsError } = conversationIds.length
      ? await supabase
          .from("conversations")
          .select("id, conversation_type")
          .eq("workspace_id", workspaceId)
          .in("id", conversationIds)
      : { data: [], error: null };

    if (conversationsError) {
      throw new Error("Não foi possível carregar as conversas dos contatos.");
    }

    const individualConversationIds = new Set(
      (conversations ?? [])
        .filter((conversation) => conversation.conversation_type === "individual")
        .map((conversation) => conversation.id),
    );
    const candidatesByContact = new Map<string, Set<string>>();

    for (const participant of participants ?? []) {
      if (!participant.contact_point_id || !participant.conversation_id) continue;
      if (!individualConversationIds.has(participant.conversation_id)) continue;
      const contactId = pointToContact.get(participant.contact_point_id);
      if (!contactId) continue;
      const candidates = candidatesByContact.get(contactId) ?? new Set<string>();
      candidates.add(participant.conversation_id);
      candidatesByContact.set(contactId, candidates);
    }

    for (const [contactId, candidates] of candidatesByContact) {
      if (candidates.size === 1) {
        conversationsByContact.set(contactId, [...candidates][0]);
      }
    }
  }

  return {
    contacts: contacts.map((contact) => ({
      ...(phonesByContact.get(contact.id)?.length === 1
        ? { phoneDisplayValue: phonesByContact.get(contact.id)?.[0] ?? null }
        : { phoneDisplayValue: null }),
      archivedAt: contact.archived_at,
      avatarUrl: avatarsByContact.get(contact.id) ?? null,
      classification: contact.classification as ContactClassification,
      conversationId: conversationsByContact.get(contact.id) ?? null,
      displayName: contact.display_name,
      hasMultipleActivePhones: (phonesByContact.get(contact.id)?.length ?? 0) > 1,
      id: contact.id,
      isProtected: contact.is_protected,
      operationalStatus: contact.operational_status as ContactOperationalStatus,
    })),
    page: filters.page,
    total: count ?? 0,
  };
}

export { pageSize };
