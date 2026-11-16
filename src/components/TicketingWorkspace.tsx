import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  CheckCircle2,
  Clock,
  Cpu,
  Lock,
  MessageSquare,
  Plus,
  Search,
  Send,
  Timer,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  ApiTraceEntry,
  CommentRole,
  TicketCategory,
  TicketPriority,
  TicketRecord,
  TicketStatus,
} from '../types/tickets';
import { PydanticTracePanel } from './PydanticTracePanel';
import {
  playBellNotification,
  unlockNotificationAudio,
} from '../utils/notificationSound';

interface CustomerNotification {
  id: string;
  ticketId: string;
  title: string;
  message: string;
  status: TicketStatus;
  createdAt: string;
  unread: boolean;
}

interface TicketingWorkspaceProps {
  openCreateSignal: number;
  onViewPythonCode: () => void;
}

interface ValidationErrorDetail {
  loc: string[];
  msg: string;
  type: string;
}

const STATUS_LABELS: Record<TicketStatus, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  resolved: 'Resolved',
  closed: 'Closed',
};

const PRIORITY_LABELS: Record<TicketPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
};

const CATEGORY_LABELS: Record<TicketCategory, string> = {
  billing: 'Billing',
  bug: 'Bug',
  feature: 'Feature',
  account: 'Account',
};

function formatShortTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

function formatCountdown(
  deadlineIso: string,
  nowMs: number
): { label: string; remainingSeconds: number; remainingMs: number; expired: boolean } {
  const diffMs = Date.parse(deadlineIso) - nowMs;
  if (Number.isNaN(diffMs) || diffMs <= 0) {
    return { label: '00:00', remainingSeconds: 0, remainingMs: 0, expired: true };
  }
  const totalSec = Math.ceil(diffMs / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return {
    label: `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`,
    remainingSeconds: totalSec,
    remainingMs: diffMs,
    expired: false,
  };
}

const SEEN_GREETINGS_STORAGE_KEY = 'schemaflow_seen_greetings_v1';

function loadSeenGreetings(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.sessionStorage.getItem(SEEN_GREETINGS_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.map(String)) : new Set();
  } catch {
    return new Set();
  }
}

function persistSeenGreetings(seen: Set<string>): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(
      SEEN_GREETINGS_STORAGE_KEY,
      JSON.stringify(Array.from(seen).slice(-100))
    );
  } catch {
    // Ignore storage quota issues
  }
}

export const TicketingWorkspace: React.FC<TicketingWorkspaceProps> = ({
  openCreateSignal,
  onViewPythonCode,
}) => {
  const [allTickets, setAllTickets] = useState<TicketRecord[]>([]);
  const [filteredTickets, setFilteredTickets] = useState<TicketRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<'all' | TicketStatus>('all');
  const [priorityFilter, setPriorityFilter] = useState<'all' | TicketPriority>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [lastTrace, setLastTrace] = useState<ApiTraceEntry | null>(null);

  // Gemini triage state
  const [isTriaging, setIsTriaging] = useState<boolean>(false);
  const [triageError, setTriageError] = useState<string | null>(null);

  // Create modal state
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [formTitle, setFormTitle] = useState<string>('');
  const [formEmail, setFormEmail] = useState<string>('');
  const [formPriority, setFormPriority] = useState<TicketPriority>('medium');
  const [formCategory, setFormCategory] = useState<TicketCategory>('bug');
  const [formDescription, setFormDescription] = useState<string>('');
  const [formParentTicketId, setFormParentTicketId] = useState<string | null>(null);
  const [omitOptionalDefaults, setOmitOptionalDefaults] = useState<boolean>(false);
  const [formErrors, setFormErrors] = useState<ValidationErrorDetail[]>([]);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isExpiringId, setIsExpiringId] = useState<string | null>(null);

  // Live 1s countdown clock for 5-minute auto-close deadlines
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const expiredSyncDoneRef = useRef<Set<string>>(new Set());

  // Comment & reply state
  const [replyRole, setReplyRole] = useState<CommentRole>('customer');
  const [commentAuthor, setCommentAuthor] = useState<string>('');
  const [commentBody, setCommentBody] = useState<string>('');
  const [commentError, setCommentError] = useState<string | null>(null);
  const [isPostingComment, setIsPostingComment] = useState<boolean>(false);

  // Customer LLM update notifications + bell chime
  const [notifications, setNotifications] = useState<CustomerNotification[]>([]);
  const [isNotifOpen, setIsNotifOpen] = useState<boolean>(false);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [bellAnimating, setBellAnimating] = useState<boolean>(false);
  const [isGreetingOpenQueue, setIsGreetingOpenQueue] = useState<boolean>(false);
  const notifContainerRef = useRef<HTMLDivElement | null>(null);
  const seenGreetingsRef = useRef<Set<string>>(loadSeenGreetings());

  const unreadCount = useMemo(
    () => notifications.filter((n) => n.unread).length,
    [notifications]
  );

  const markGreetingSeen = useCallback((ticket: TicketRecord, triagedAt?: string | null) => {
    const ts = triagedAt ?? ticket.ai_triage?.triaged_at;
    if (!ts) return;
    const key = `${ticket.id}:${ts}`;
    if (!seenGreetingsRef.current.has(key)) {
      seenGreetingsRef.current.add(key);
      persistSeenGreetings(seenGreetingsRef.current);
    }
  }, []);

  const notifyCustomerLlmUpdate = useCallback(
    (
      ticket: TicketRecord,
      message: string,
      opts?: { playSound?: boolean; triagedAt?: string | null }
    ) => {
      markGreetingSeen(ticket, opts?.triagedAt);
      const entry: CustomerNotification = {
        id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        ticketId: ticket.id,
        title: `${ticket.id} · ${ticket.title}`,
        message,
        status: ticket.status,
        createdAt: new Date().toISOString(),
        unread: true,
      };
      setNotifications((prev) => [entry, ...prev].slice(0, 12));
      setBellAnimating(true);
      window.setTimeout(() => setBellAnimating(false), 650);
      if (opts?.playSound !== false && soundEnabled) {
        playBellNotification();
      }
    },
    [markGreetingSeen, soundEnabled]
  );

  const announceUnseenGreetings = useCallback(
    (tickets: TicketRecord[]) => {
      const unseen = tickets.filter((t) => {
        const ts = t.ai_triage?.triaged_at;
        const reply = t.ai_triage?.suggested_reply;
        if (!ts || !reply) return false;
        return !seenGreetingsRef.current.has(`${t.id}:${ts}`);
      });

      if (unseen.length === 0) return;

      const entries: CustomerNotification[] = unseen.map((t, idx) => {
        markGreetingSeen(t, t.ai_triage?.triaged_at);
        return {
          id: `notif-load-${Date.now()}-${idx}-${t.id}`,
          ticketId: t.id,
          title: `${t.id} · ${t.title}`,
          message: t.ai_triage!.suggested_reply,
          status: t.status,
          createdAt: t.ai_triage!.triaged_at,
          unread: true,
        };
      });

      setNotifications((prev) => [...entries, ...prev].slice(0, 12));
      setBellAnimating(true);
      window.setTimeout(() => setBellAnimating(false), 650);
      if (soundEnabled) {
        playBellNotification();
      }
    },
    [markGreetingSeen, soundEnabled]
  );

  useEffect(() => {
    if (!isNotifOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (
        notifContainerRef.current &&
        !notifContainerRef.current.contains(event.target as Node)
      ) {
        setIsNotifOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsNotifOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleKey);
    };
  }, [isNotifOpen]);

  const fetchTickets = useCallback(
    async (opts?: { recordTrace?: boolean }) => {
      setIsLoading(true);
      setLoadError(null);
      try {
        const params = new URLSearchParams();
        if (statusFilter !== 'all') params.set('status', statusFilter);
        if (priorityFilter !== 'all') params.set('priority', priorityFilter);
        if (searchQuery.trim()) params.set('q', searchQuery.trim());

        const qs = params.toString();
        const url = qs ? `/api/tickets?${qs}` : '/api/tickets';

        const [filteredRes, allRes] = await Promise.all([
          fetch(url),
          qs ? fetch('/api/tickets') : Promise.resolve(null),
        ]);

        if (!filteredRes.ok) throw new Error(`HTTP ${filteredRes.status}`);
        const payload = await filteredRes.json();
        const items: TicketRecord[] = Array.isArray(payload) ? payload : payload.tickets ?? [];

        setFilteredTickets(items);
        let fullList = items;
        if (allRes && allRes.ok) {
          const allPayload = await allRes.json();
          fullList = Array.isArray(allPayload) ? allPayload : allPayload.tickets ?? [];
          setAllTickets(fullList);
        } else {
          setAllTickets(items);
        }

        announceUnseenGreetings(fullList);

        setSelectedId((prev) => {
          if (prev && items.some((t) => t.id === prev)) return prev;
          return items[0]?.id ?? null;
        });

        if (opts?.recordTrace !== false && !Array.isArray(payload) && payload.trace) {
          setLastTrace(payload.trace);
        }
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : 'Failed to load tickets');
      } finally {
        setIsLoading(false);
      }
    },
    [statusFilter, priorityFilter, searchQuery, announceUnseenGreetings]
  );

  useEffect(() => {
    fetchTickets({ recordTrace: true });
  }, [fetchTickets]);

  useEffect(() => {
    if (openCreateSignal > 0) {
      setFormParentTicketId(null);
      setFormTitle('');
      setFormEmail('');
      setFormDescription('');
      setFormPriority('medium');
      setFormCategory('bug');
      setFormErrors([]);
      setIsModalOpen(true);
    }
  }, [openCreateSignal]);

  const hasActiveDeadlines = useMemo(
    () =>
      allTickets.some(
        (t) => t.status !== 'resolved' && t.status !== 'closed' && Boolean(t.reply_deadline_at)
      ),
    [allTickets]
  );

  useEffect(() => {
    if (!hasActiveDeadlines) return;
    setNowMs(Date.now());
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [hasActiveDeadlines]);

  useEffect(() => {
    const expiredIds = allTickets
      .filter(
        (t) =>
          t.status !== 'resolved' &&
          t.status !== 'closed' &&
          t.reply_deadline_at &&
          Date.parse(t.reply_deadline_at) <= nowMs &&
          !expiredSyncDoneRef.current.has(`${t.id}:${t.reply_deadline_at}`)
      )
      .map((t) => `${t.id}:${t.reply_deadline_at}`);

    if (expiredIds.length > 0) {
      expiredIds.forEach((key) => expiredSyncDoneRef.current.add(key));
      window.setTimeout(() => {
        fetchTickets({ recordTrace: false });
      }, 150);
    }
  }, [allTickets, nowMs, fetchTickets]);

  useEffect(() => {
    if (!isModalOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsModalOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isModalOpen]);

  const selectedTicket = useMemo(
    () =>
      filteredTickets.find((t) => t.id === selectedId) ??
      allTickets.find((t) => t.id === selectedId) ??
      filteredTickets[0] ??
      null,
    [filteredTickets, allTickets, selectedId]
  );

  useEffect(() => {
    setTriageError(null);
    setCommentError(null);
    if (selectedTicket) {
      setCommentAuthor(
        replyRole === 'customer' ? selectedTicket.requester_email : 'Alex Rivera'
      );
    }
  }, [selectedTicket?.id, replyRole, selectedTicket?.requester_email]);

  const counts = useMemo(() => {
    return {
      total: allTickets.length,
      open: allTickets.filter((t) => t.status === 'open').length,
      inProgress: allTickets.filter((t) => t.status === 'in_progress').length,
      resolved: allTickets.filter((t) => t.status === 'resolved').length,
      closed: allTickets.filter((t) => t.status === 'closed').length,
    };
  }, [allTickets]);

  const openCreateFromClosedTicket = (closedTicket: TicketRecord) => {
    const baseTitle = closedTicket.title.startsWith('Follow-up:')
      ? closedTicket.title
      : `Follow-up: ${closedTicket.title}`;
    setFormParentTicketId(closedTicket.id);
    setFormTitle(baseTitle.slice(0, 120));
    setFormEmail(closedTicket.requester_email);
    setFormPriority(closedTicket.priority);
    setFormCategory(closedTicket.category);
    setFormDescription('');
    setOmitOptionalDefaults(false);
    setFormErrors([]);
    setIsModalOpen(true);
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    unlockNotificationAudio();
    setIsSubmitting(true);
    setFormErrors([]);

    const payload: Record<string, unknown> = {
      title: formTitle,
      description: formDescription,
      requester_email: formEmail,
    };

    if (!omitOptionalDefaults) {
      payload.priority = formPriority;
      payload.category = formCategory;
    }
    if (formParentTicketId) {
      payload.parent_ticket_id = formParentTicketId;
    }

    try {
      const res = await fetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (data.trace) {
        setLastTrace(data.trace);
      }

      if (res.status === 422 && Array.isArray(data.detail)) {
        setFormErrors(data.detail);
        return;
      }

      if (!res.ok) {
        setFormErrors([
          { loc: ['server'], msg: `Request failed with status ${res.status}`, type: 'http_error' },
        ]);
        return;
      }

      const created = (data.ticket ?? data) as TicketRecord;
      setAllTickets((prev) => [
        created,
        ...prev.map((t) =>
          formParentTicketId && t.id === formParentTicketId
            ? { ...t, superseded_by_ticket_id: created.id }
            : t
        ),
      ]);
      setFilteredTickets((prev) => [
        created,
        ...prev.map((t) =>
          formParentTicketId && t.id === formParentTicketId
            ? { ...t, superseded_by_ticket_id: created.id }
            : t
        ),
      ]);
      setSelectedId(created.id);

      const autoReplyMsg =
        data.triage?.suggested_reply ?? created.comments?.[0]?.body ?? null;
      if (data.auto_replied && autoReplyMsg) {
        notifyCustomerLlmUpdate(created, autoReplyMsg, {
          playSound: true,
          triagedAt: data.triage?.triaged_at ?? created.ai_triage?.triaged_at,
        });
      }

      setFormTitle('');
      setFormEmail('');
      setFormDescription('');
      setFormPriority('medium');
      setFormCategory('bug');
      setFormParentTicketId(null);
      setIsModalOpen(false);
    } catch {
      setFormErrors([{ loc: ['network'], msg: 'Network error submitting ticket', type: 'network' }]);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleExpireTicket = async (ticketId: string, delaySeconds = 0) => {
    setIsExpiringId(ticketId);
    try {
      const res = await fetch(`/api/tickets/${ticketId}/expire`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(delaySeconds > 0 ? { delay_seconds: delaySeconds } : {}),
      });
      const data = await res.json();
      if (data.trace) {
        setLastTrace(data.trace);
      }
      if (res.ok && data.ticket) {
        const updated = data.ticket as TicketRecord;
        setAllTickets((prev) => prev.map((t) => (t.id === ticketId ? updated : t)));
        setFilteredTickets((prev) => prev.map((t) => (t.id === ticketId ? updated : t)));
        setNowMs(Date.now());
      }
    } finally {
      setIsExpiringId(null);
    }
  };

  const handleRunGeminiTriage = async (ticketId: string) => {
    unlockNotificationAudio();
    setIsTriaging(true);
    setTriageError(null);

    try {
      const res = await fetch(`/api/tickets/${ticketId}/triage`, {
        method: 'POST',
      });
      const data = await res.json();

      if (data.trace) {
        setLastTrace(data.trace);
      }

      if (!res.ok) {
        const msg =
          typeof data.detail === 'string'
            ? data.detail
            : Array.isArray(data.detail)
            ? data.detail.map((d: ValidationErrorDetail) => d.msg).join(' · ')
            : `Gemini triage failed (${res.status})`;
        setTriageError(msg);
        return;
      }

      const updated = data.ticket as TicketRecord;
      setAllTickets((prev) => prev.map((t) => (t.id === ticketId ? updated : t)));
      setFilteredTickets((prev) => prev.map((t) => (t.id === ticketId ? updated : t)));
      if (updated.ai_triage?.suggested_reply) {
        notifyCustomerLlmUpdate(updated, updated.ai_triage.suggested_reply, {
          playSound: true,
          triagedAt: updated.ai_triage.triaged_at,
        });
      }
    } catch {
      setTriageError('Network error running Gemini triage.');
    } finally {
      setIsTriaging(false);
    }
  };

  const handleGreetOpenQueue = async () => {
    unlockNotificationAudio();
    setIsGreetingOpenQueue(true);
    try {
      const res = await fetch('/api/tickets/greet-open', { method: 'POST' });
      const data = await res.json();
      if (data.trace) {
        setLastTrace(data.trace);
      }
      if (res.ok) {
        const greetedList: TicketRecord[] = Array.isArray(data.greeted_tickets)
          ? data.greeted_tickets
          : [];
        greetedList.forEach((t, idx) => {
          const msg = t.ai_triage?.suggested_reply ?? t.comments?.[t.comments.length - 1]?.body;
          if (msg) {
            notifyCustomerLlmUpdate(t, msg, {
              playSound: idx === 0,
              triagedAt: t.ai_triage?.triaged_at,
            });
          }
        });
        await fetchTickets({ recordTrace: false });
      }
    } finally {
      setIsGreetingOpenQueue(false);
    }
  };

  const handleUpdateTicket = async (
    ticketId: string,
    patch: Partial<{
      status: TicketStatus;
      priority: TicketPriority;
      category: TicketCategory;
      assignee: string | null;
    }>
  ) => {
    try {
      const res = await fetch(`/api/tickets/${ticketId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await res.json();

      if (data.trace) {
        setLastTrace(data.trace);
      }

      if (res.ok) {
        const updated = (data.ticket ?? data) as TicketRecord;
        setAllTickets((prev) => prev.map((t) => (t.id === ticketId ? updated : t)));
        setFilteredTickets((prev) => prev.map((t) => (t.id === ticketId ? updated : t)));
      }
    } catch {
      // Keep UI resilient
    }
  };

  const postCommentText = async (
    ticketId: string,
    author: string,
    body: string,
    role: CommentRole
  ) => {
    unlockNotificationAudio();
    setIsPostingComment(true);
    setCommentError(null);

    const payload = { author, body, role };
    try {
      const res = await fetch(`/api/tickets/${ticketId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (data.trace) {
        setLastTrace(data.trace);
      }

      if (res.status === 422 && Array.isArray(data.detail)) {
        setCommentError(data.detail.map((d: ValidationErrorDetail) => d.msg).join(' · '));
        return false;
      }

      if (res.status === 409) {
        setCommentError(
          typeof data.detail === 'string'
            ? data.detail
            : 'Ticket was auto-closed. Please create a new ticket.'
        );
        if (data.ticket) {
          const closed = data.ticket as TicketRecord;
          setAllTickets((prev) => prev.map((t) => (t.id === closed.id ? closed : t)));
          setFilteredTickets((prev) => prev.map((t) => (t.id === closed.id ? closed : t)));
        }
        return false;
      }

      if (res.ok) {
        const updated = (data.ticket ?? data) as TicketRecord;
        setAllTickets((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
        setFilteredTickets((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
        if (data.auto_replied && data.triage?.suggested_reply) {
          notifyCustomerLlmUpdate(updated, data.triage.suggested_reply, {
            playSound: true,
            triagedAt: data.triage.triaged_at,
          });
        }
        return true;
      }
      return false;
    } finally {
      setIsPostingComment(false);
    }
  };

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTicket) return;
    const ok = await postCommentText(selectedTicket.id, commentAuthor, commentBody, replyRole);
    if (ok) setCommentBody('');
  };

  const handleDeleteTicket = async (ticketId: string) => {
    const res = await fetch(`/api/tickets/${ticketId}`, { method: 'DELETE' });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;

    if (data?.trace) {
      setLastTrace(data.trace);
    } else {
      setLastTrace({
        method: 'DELETE',
        path: `/api/tickets/${ticketId}`,
        statusCode: res.status,
        pydanticModel: 'Path Parameter (ticket_id: str)',
        pydanticEngine: 'FastAPI Path Contract',
        parameterTrace: [
          {
            param: 'ticket_id',
            location: 'path',
            raw_value: ticketId,
            validated_value: ticketId,
            pydantic_type: 'str',
            constraint: 'Path parameter matched',
            source: 'client',
            status: res.ok ? 'pass' : 'fail',
          },
        ],
        responseBody: res.status === 204 ? { status: 'deleted' } : data,
        timestamp: new Date().toISOString(),
      });
    }

    if (res.ok) {
      setAllTickets((prev) => prev.filter((t) => t.id !== ticketId));
      setFilteredTickets((prev) => {
        const next = prev.filter((t) => t.id !== ticketId);
        if (selectedId === ticketId) {
          setSelectedId(next[0]?.id ?? null);
        }
        return next;
      });
    }
  };

  const fillInvalidTest = () => {
    setFormTitle('Hi');
    setFormEmail('not-an-email');
    setFormDescription('Short');
    setOmitOptionalDefaults(false);
    setFormErrors([]);
  };

  const getStatusBadge = (status: TicketStatus) => {
    if (status === 'open') {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-sky-800 whitespace-nowrap">
          <Clock className="w-3.5 h-3.5 text-sky-700" aria-hidden="true" />
          Open
        </span>
      );
    }
    if (status === 'in_progress') {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-800 whitespace-nowrap">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-700" aria-hidden="true" />
          In Progress
        </span>
      );
    }
    if (status === 'closed') {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-rose-800 whitespace-nowrap">
          <Lock className="w-3.5 h-3.5 text-rose-700" aria-hidden="true" />
          Closed
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-800 whitespace-nowrap">
        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" aria-hidden="true" />
        Resolved
      </span>
    );
  };

  const getPriorityText = (priority: TicketPriority) => {
    if (priority === 'urgent') return 'text-rose-700 font-semibold';
    if (priority === 'high') return 'text-amber-800 font-semibold';
    if (priority === 'medium') return 'text-slate-700 font-medium';
    return 'text-slate-500 font-normal';
  };

  return (
    <section className="space-y-6">
      {/* Header Row */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div className="max-w-2xl">
          <p className="text-sm font-medium text-sky-700 mb-1">
            Support Queue · Gemini + Python Pydantic
          </p>
          <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 text-balance">
            Simple Python Ticketing Workspace
          </h1>
          <p className="mt-2 text-base text-slate-600 leading-relaxed">
            Every ticket request passes through Python Pydantic, and Gemini reads the full conversation thread to auto-triage status and reply to customers.
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {/* Customer LLM Notification Bell */}
          <div className="relative" ref={notifContainerRef}>
            <button
              type="button"
              onClick={() => {
                unlockNotificationAudio();
                setIsNotifOpen((open) => !open);
              }}
              aria-label={`Customer notifications (${unreadCount} unread)`}
              aria-expanded={isNotifOpen}
              className={`relative inline-flex items-center justify-center w-10 h-10 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-transform cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 ${
                bellAnimating ? 'scale-105 border-sky-600 text-sky-700' : 'text-slate-700'
              }`}
            >
              <Bell className="w-4 h-4" aria-hidden="true" />
              {unreadCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-5 h-5 px-1 inline-flex items-center justify-center text-[11px] font-mono font-bold text-white bg-sky-700 rounded-md tabular-nums">
                  {unreadCount}
                </span>
              )}
            </button>

            {isNotifOpen && (
              <div
                role="region"
                aria-label="Customer LLM update notifications"
                className="absolute right-0 mt-2 w-80 sm:w-96 bg-white border border-slate-200 rounded-xl shadow-lg z-40 overflow-hidden"
              >
                <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-semibold text-slate-900">
                      Customer LLM Updates
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Chimes whenever Gemini sends a customer update
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        unlockNotificationAudio();
                        playBellNotification();
                      }}
                      className="px-2 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded transition-colors whitespace-nowrap cursor-pointer"
                    >
                      Test Bell
                    </button>
                    <button
                      type="button"
                      onClick={() => setSoundEnabled((prev) => !prev)}
                      aria-label={soundEnabled ? 'Mute bell sound' : 'Unmute bell sound'}
                      className="p-1.5 text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded transition-colors cursor-pointer"
                    >
                      {soundEnabled ? (
                        <Volume2 className="w-3.5 h-3.5" aria-hidden="true" />
                      ) : (
                        <VolumeX className="w-3.5 h-3.5" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                </div>

                <div className="max-h-72 overflow-y-auto divide-y divide-slate-200">
                  {notifications.length === 0 ? (
                    <div className="p-5 text-center text-xs text-slate-500">
                      No LLM updates yet. Send a customer reply or run Auto-Triage with Gemini to trigger an update and bell chime.
                    </div>
                  ) : (
                    notifications.map((n) => (
                      <button
                        key={n.id}
                        type="button"
                        onClick={() => {
                          setSelectedId(n.ticketId);
                          setNotifications((prev) =>
                            prev.map((item) =>
                              item.id === n.id ? { ...item, unread: false } : item
                            )
                          );
                          setIsNotifOpen(false);
                        }}
                        className={`w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors cursor-pointer ${
                          n.unread ? 'bg-sky-50/50' : 'bg-white'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 text-xs mb-1">
                          <span className="font-semibold text-slate-900 truncate">
                            {n.title}
                          </span>
                          <span className="font-mono text-[11px] text-slate-500 shrink-0 tabular-nums">
                            {formatShortTime(n.createdAt)}
                          </span>
                        </div>
                        <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed">
                          {n.message}
                        </p>
                        <div className="mt-1.5 flex items-center gap-2 text-[11px] text-slate-500">
                          <span className="font-medium text-sky-700">
                            {STATUS_LABELS[n.status]}
                          </span>
                          {n.unread && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="font-semibold text-slate-900">Unread</span>
                            </>
                          )}
                        </div>
                      </button>
                    ))
                  )}
                </div>

                {notifications.length > 0 && unreadCount > 0 && (
                  <div className="px-4 py-2.5 border-t border-slate-200 bg-slate-50 flex justify-end">
                    <button
                      type="button"
                      onClick={() =>
                        setNotifications((prev) =>
                          prev.map((item) => ({ ...item, unread: false }))
                        )
                      }
                      className="text-xs font-semibold text-sky-700 hover:text-sky-800 cursor-pointer"
                    >
                      Mark all read
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={onViewPythonCode}
            className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600"
          >
            View Python Source
          </button>
          <button
            type="button"
            onClick={() => {
              setFormParentTicketId(null);
              setFormTitle('');
              setFormEmail('');
              setFormDescription('');
              setFormPriority('medium');
              setFormCategory('bug');
              setFormErrors([]);
              setIsModalOpen(true);
            }}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-sky-700 hover:bg-sky-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600"
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            New Ticket
          </button>
        </div>
      </div>

      {/* 5-Column KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500">Total Tickets</div>
          <div className="mt-1 font-display text-2xl font-bold text-slate-900 tabular-nums">
            {counts.total}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500">Open Queue</div>
          <div className="mt-1 font-display text-2xl font-bold text-sky-700 tabular-nums">
            {counts.open}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500">In Progress</div>
          <div className="mt-1 font-display text-2xl font-bold text-amber-700 tabular-nums">
            {counts.inProgress}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500">Resolved</div>
          <div className="mt-1 font-display text-2xl font-bold text-emerald-700 tabular-nums">
            {counts.resolved}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 col-span-2 sm:col-span-1">
          <div className="text-xs font-medium text-slate-500">Auto-Closed</div>
          <div className="mt-1 font-display text-2xl font-bold text-rose-700 tabular-nums">
            {counts.closed}
          </div>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 sm:p-4 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
          {(['all', 'open', 'in_progress', 'resolved', 'closed'] as const).map((st) => {
            const active = statusFilter === st;
            return (
              <button
                key={st}
                type="button"
                onClick={() => setStatusFilter(st)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  active
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {st === 'all' ? 'All Statuses' : STATUS_LABELS[st]}
              </button>
            );
          })}
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          {counts.open > 0 && (
            <button
              type="button"
              disabled={isGreetingOpenQueue}
              onClick={handleGreetOpenQueue}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-sky-800 bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
            >
              <Cpu className="w-3.5 h-3.5" aria-hidden="true" />
              {isGreetingOpenQueue
                ? 'Greeting Open Queue...'
                : `Greet Open Queue (${counts.open})`}
            </button>
          )}

          <div className="relative">
            <Search
              className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search ID, title, or email..."
              aria-label="Search tickets"
              className="w-full sm:w-64 pl-9 pr-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-600"
            />
          </div>

          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value as 'all' | TicketPriority)}
            aria-label="Filter by priority"
            className="px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-600"
          >
            <option value="all">All Priorities</option>
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>
      </div>

      {/* Master-Detail Split Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: High-Density Ticket Table */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
          {isLoading && filteredTickets.length === 0 ? (
            <div className="p-6 space-y-3" aria-label="Loading tickets">
              {[1, 2, 3, 4].map((n) => (
                <div key={n} className="h-11 bg-slate-100 rounded-md animate-pulse" />
              ))}
            </div>
          ) : loadError ? (
            <div className="p-8 text-center">
              <p className="text-sm font-medium text-rose-700 mb-3">
                Could not load tickets: {loadError}
              </p>
              <button
                type="button"
                onClick={() => fetchTickets({ recordTrace: true })}
                className="px-4 py-2 text-sm font-semibold text-white bg-slate-900 rounded-lg cursor-pointer"
              >
                Retry
              </button>
            </div>
          ) : filteredTickets.length === 0 ? (
            <div className="p-10 text-center">
              <p className="text-sm font-semibold text-slate-900">
                No matching tickets found
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Adjust your query parameters or submit a new support ticket.
              </p>
              <button
                type="button"
                onClick={() => {
                  setStatusFilter('all');
                  setPriorityFilter('all');
                  setSearchQuery('');
                  setIsModalOpen(true);
                }}
                className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-sky-700 hover:bg-sky-800 rounded-lg cursor-pointer"
              >
                <Plus className="w-4 h-4" aria-hidden="true" />
                Create First Ticket
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold text-slate-500">
                    <th className="py-3 px-4 whitespace-nowrap">ID</th>
                    <th className="py-3 px-4">Subject</th>
                    <th className="py-3 px-4 whitespace-nowrap">Priority</th>
                    <th className="py-3 px-4 whitespace-nowrap">Status</th>
                    <th className="py-3 px-4 text-right whitespace-nowrap">Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-sm">
                  {filteredTickets.map((ticket) => {
                    const isSelected = selectedTicket?.id === ticket.id;
                    return (
                      <tr
                        key={ticket.id}
                        onClick={() => setSelectedId(ticket.id)}
                        className={`cursor-pointer transition-colors ${
                          isSelected ? 'bg-sky-50/70' : 'hover:bg-slate-50'
                        }`}
                      >
                        <td className="py-3 px-4 font-mono text-xs font-semibold text-slate-700 whitespace-nowrap">
                          {ticket.id}
                        </td>
                        <td className="py-3 px-4 min-w-[200px]">
                          <div className="font-medium text-slate-900 line-clamp-1">
                            {ticket.title}
                          </div>
                          <div className="text-xs text-slate-500 flex items-center gap-1.5 mt-0.5">
                            <span className="truncate max-w-[180px]">{ticket.requester_email}</span>
                            <span aria-hidden="true">·</span>
                            <span>{CATEGORY_LABELS[ticket.category]}</span>
                          </div>
                        </td>
                        <td
                          className={`py-3 px-4 text-xs whitespace-nowrap ${getPriorityText(
                            ticket.priority
                          )}`}
                        >
                          {PRIORITY_LABELS[ticket.priority]}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <div className="flex flex-col gap-1">
                            {getStatusBadge(ticket.status)}
                            {ticket.status !== 'resolved' &&
                              ticket.status !== 'closed' &&
                              ticket.reply_deadline_at &&
                              (() => {
                                const cd = formatCountdown(ticket.reply_deadline_at, nowMs);
                                if (cd.remainingSeconds <= 5) {
                                  return (
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded border border-black bg-white font-mono text-[11px] font-bold text-black tabular-nums w-fit">
                                      {cd.remainingSeconds}s left
                                    </span>
                                  );
                                }
                                return null;
                              })()}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-xs text-slate-500 tabular-nums whitespace-nowrap">
                          {formatShortTime(ticket.updated_at)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right: Ticket Detail & Live Pydantic Parameter Trace */}
        <div className="lg:col-span-5 space-y-6">
          {selectedTicket ? (
            <div className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-5">
              <div className="flex items-start justify-between gap-4 pb-4 border-b border-slate-200">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 font-mono mb-1">
                    <span className="font-semibold text-slate-800">{selectedTicket.id}</span>
                    <span aria-hidden="true">·</span>
                    <span>{CATEGORY_LABELS[selectedTicket.category]}</span>
                    {selectedTicket.parent_ticket_id && (
                      <>
                        <span aria-hidden="true">·</span>
                        <button
                          type="button"
                          onClick={() => setSelectedId(selectedTicket.parent_ticket_id!)}
                          className="text-sky-700 hover:underline cursor-pointer"
                        >
                          Follow-up to {selectedTicket.parent_ticket_id}
                        </button>
                      </>
                    )}
                  </div>
                  <h2 className="font-display text-lg font-bold text-slate-900 leading-snug">
                    {selectedTicket.title}
                  </h2>
                  <p className="mt-1 text-xs text-slate-500">
                    Requester: {selectedTicket.requester_email}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => handleDeleteTicket(selectedTicket.id)}
                  aria-label={`Delete ${selectedTicket.id}`}
                  className="p-2 text-slate-400 hover:text-rose-700 hover:bg-rose-50 rounded-lg transition-colors shrink-0 cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>

              <p className="text-sm text-slate-700 leading-relaxed">
                {selectedTicket.description}
              </p>

              {/* 5-Minute Reply Deadline Bar or Auto-Closed Banner */}
              {selectedTicket.status === 'closed' ? (
                <div className="p-4 rounded-lg bg-rose-50 border border-rose-200 space-y-3">
                  <div className="flex items-start gap-2.5">
                    <Lock className="w-4 h-4 text-rose-700 shrink-0 mt-0.5" aria-hidden="true" />
                    <div className="text-xs text-rose-900 space-y-1">
                      <div className="font-semibold">
                        Ticket Auto-Closed (5-Minute Reply Window Expired)
                      </div>
                      <p className="text-rose-800 leading-relaxed">
                        {selectedTicket.closed_reason ||
                          'No customer reply was received within 5 minutes.'}{' '}
                        Closed tickets cannot be reopened—a new ticket must be created to continue.
                      </p>
                    </div>
                  </div>
                  {selectedTicket.superseded_by_ticket_id ? (
                    <button
                      type="button"
                      onClick={() => setSelectedId(selectedTicket.superseded_by_ticket_id!)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-sky-800 bg-white border border-sky-200 hover:bg-sky-50 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                    >
                      View New Ticket ({selectedTicket.superseded_by_ticket_id})
                      <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => openCreateFromClosedTicket(selectedTicket)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-sky-700 hover:bg-sky-800 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                      Create New Ticket
                    </button>
                  )}
                </div>
              ) : (
                selectedTicket.status !== 'resolved' &&
                selectedTicket.reply_deadline_at &&
                (() => {
                  const countdown = formatCountdown(selectedTicket.reply_deadline_at, nowMs);
                  if (countdown.remainingSeconds > 5) {
                    return null;
                  }
                  const pct = Math.max(0, Math.min(100, (countdown.remainingMs / 5000) * 100));
                  return (
                    <div
                      role="timer"
                      aria-live="polite"
                      className="p-4 rounded-lg bg-white border-2 border-black space-y-2.5 text-black"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 text-xs font-semibold text-black">
                          <Timer className="w-4 h-4 text-black shrink-0" aria-hidden="true" />
                          <span>Ticket Closing Soon</span>
                        </div>
                        <span className="px-2.5 py-1 rounded-md border border-black bg-white font-mono text-lg font-bold text-black tabular-nums">
                          {countdown.remainingSeconds}s
                        </span>
                      </div>
                      <div className="h-1.5 w-full bg-slate-200 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-black transition-[width] duration-700 ease-linear"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <p className="text-xs text-black/80 leading-relaxed">
                        Auto-closing in {countdown.remainingSeconds}s due to reply delay. Send a customer reply below to keep this ticket open, or a new ticket will be required.
                      </p>
                    </div>
                  );
                })()
              )}

              {/* Gemini + Pydantic Triage Action Bar */}
              <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-slate-900">
                      Gemini + Pydantic Thread Triage
                    </div>
                    <div className="text-xs text-slate-500">
                      Auto-replies when opened; closes after 5-min reply delay
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {selectedTicket.status !== 'resolved' &&
                      selectedTicket.status !== 'closed' &&
                      selectedTicket.reply_deadline_at &&
                      formatCountdown(selectedTicket.reply_deadline_at, nowMs).remainingSeconds > 5 && (
                        <button
                          type="button"
                          disabled={isExpiringId === selectedTicket.id}
                          onClick={() => handleExpireTicket(selectedTicket.id, 5)}
                          className="px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                        >
                          {isExpiringId === selectedTicket.id ? 'Starting...' : 'Test 5s Close'}
                        </button>
                      )}

                    <button
                      type="button"
                      disabled={isTriaging || selectedTicket.status === 'closed'}
                      onClick={() => handleRunGeminiTriage(selectedTicket.id)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                    >
                      <Cpu className="w-3.5 h-3.5" aria-hidden="true" />
                      {isTriaging ? 'Analyzing Thread...' : 'Auto-Triage with Gemini'}
                    </button>
                  </div>
                </div>

                {triageError && (
                  <div className="p-2.5 rounded-md bg-rose-50 border border-rose-200 text-xs text-rose-800">
                    {triageError}
                  </div>
                )}

                {selectedTicket.ai_triage && (
                  <div className="pt-3 border-t border-slate-200 space-y-2 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-slate-600">
                      <span className="font-medium text-emerald-700">
                        Verified by Python Pydantic · Confidence{' '}
                        <span className="font-mono tabular-nums">
                          {Math.round(selectedTicket.ai_triage.confidence * 100)}%
                        </span>
                      </span>
                      <span className="font-mono text-slate-500">
                        Status -&gt; {STATUS_LABELS[selectedTicket.ai_triage.recommended_status]}
                      </span>
                    </div>
                    <p className="text-slate-700 leading-relaxed">
                      <span className="font-semibold text-slate-900">Reasoning:</span>{' '}
                      {selectedTicket.ai_triage.reasoning}
                    </p>
                    <div className="p-2.5 rounded-md bg-white border border-slate-200 space-y-2">
                      <p className="text-slate-700 leading-relaxed">
                        <span className="font-semibold text-slate-900">Latest AI Reply:</span>{' '}
                        {selectedTicket.ai_triage.suggested_reply}
                      </p>
                      {selectedTicket.status !== 'closed' && (
                        <button
                          type="button"
                          disabled={isPostingComment}
                          onClick={() =>
                            postCommentText(
                              selectedTicket.id,
                              'Gemini Support',
                              selectedTicket.ai_triage!.suggested_reply,
                              'agent'
                            )
                          }
                          className="px-2.5 py-1 text-xs font-semibold text-sky-700 hover:text-sky-800 bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded transition-colors whitespace-nowrap cursor-pointer"
                        >
                          Post Reply to Thread
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Status & Priority Controls */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">
                    Status (TicketUpdate)
                  </label>
                  <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
                    {(['open', 'in_progress', 'resolved', 'closed'] as TicketStatus[]).map((st) => (
                      <button
                        key={st}
                        type="button"
                        disabled={selectedTicket.status === 'closed' && st !== 'closed'}
                        onClick={() => handleUpdateTicket(selectedTicket.id, { status: st })}
                        className={`flex-1 px-2 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                          selectedTicket.status === st
                            ? 'bg-white text-slate-900 shadow-sm'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {STATUS_LABELS[st]}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="detail-priority"
                    className="block text-xs font-medium text-slate-500 mb-1.5"
                  >
                    Priority (TicketUpdate)
                  </label>
                  <select
                    id="detail-priority"
                    value={selectedTicket.priority}
                    onChange={(e) =>
                      handleUpdateTicket(selectedTicket.id, {
                        priority: e.target.value as TicketPriority,
                      })
                    }
                    className="w-full px-3 py-2 text-xs font-medium bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-600"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
              </div>

              {/* Comments Thread */}
              <div className="pt-4 border-t border-slate-200 space-y-3">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                  <span className="inline-flex items-center gap-1.5">
                    <MessageSquare className="w-3.5 h-3.5" aria-hidden="true" />
                    Conversation Thread
                  </span>
                  <span className="tabular-nums text-slate-500">
                    {selectedTicket.comments.length}
                  </span>
                </div>

                {selectedTicket.comments.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    No messages yet. Post a customer reply or agent note below.
                  </p>
                ) : (
                  <div className="space-y-2.5 max-h-52 overflow-y-auto pr-1">
                    {selectedTicket.comments.map((c) => {
                      const isCustomer = c.role === 'customer';
                      return (
                        <div
                          key={c.id}
                          className={`p-3 rounded-lg border text-xs ${
                            isCustomer
                              ? 'bg-sky-50/60 border-sky-200'
                              : 'bg-slate-50 border-slate-200'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <div className="flex items-center gap-1.5">
                              <span className="font-semibold text-slate-900">{c.author}</span>
                              <span aria-hidden="true" className="text-slate-400">
                                ·
                              </span>
                              <span
                                className={
                                  isCustomer
                                    ? 'text-sky-700 font-medium'
                                    : 'text-slate-500 font-medium'
                                }
                              >
                                {isCustomer ? 'Customer' : 'Support'}
                              </span>
                            </div>
                            <span className="font-mono text-slate-400 tabular-nums">
                              {formatShortTime(c.created_at)}
                            </span>
                          </div>
                          <p className="text-slate-700 leading-relaxed">{c.body}</p>
                        </div>
                      );
                    })}
                  </div>
                )}

                {selectedTicket.status === 'closed' ? (
                  <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600">
                    <span>
                      Replies are disabled because this ticket auto-closed after 5 minutes.
                    </span>
                    <button
                      type="button"
                      onClick={() => openCreateFromClosedTicket(selectedTicket)}
                      className="px-3 py-1.5 font-semibold text-white bg-sky-700 hover:bg-sky-800 rounded-md transition-colors whitespace-nowrap cursor-pointer"
                    >
                      Open New Ticket
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleAddComment} className="space-y-2.5 pt-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                        <button
                          type="button"
                          onClick={() => setReplyRole('customer')}
                          className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                            replyRole === 'customer'
                              ? 'bg-white text-slate-900 shadow-sm'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          Customer Reply
                        </button>
                        <button
                          type="button"
                          onClick={() => setReplyRole('agent')}
                          className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                            replyRole === 'agent'
                              ? 'bg-white text-slate-900 shadow-sm'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          Agent Note
                        </button>
                      </div>

                      <span className="text-xs text-slate-500">
                        {replyRole === 'customer'
                          ? 'Auto-triggers Gemini response'
                          : 'Starts 5-min customer reply window'}
                      </span>
                    </div>

                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={commentAuthor}
                        onChange={(e) => setCommentAuthor(e.target.value)}
                        placeholder={replyRole === 'customer' ? 'Customer email' : 'Agent name'}
                        aria-label="Reply author"
                        className="w-36 px-2.5 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-600"
                      />
                      <input
                        type="text"
                        value={commentBody}
                        onChange={(e) => setCommentBody(e.target.value)}
                        placeholder={
                          replyRole === 'customer'
                            ? 'Simulate customer reply...'
                            : 'Add an internal or support note...'
                        }
                        aria-label="Comment body"
                        className="flex-1 px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-600"
                      />
                      <button
                        type="submit"
                        disabled={isPostingComment}
                        aria-label="Send message"
                        className="inline-flex items-center gap-1 px-3 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors shrink-0 cursor-pointer disabled:opacity-50 whitespace-nowrap"
                      >
                        <Send className="w-3.5 h-3.5" aria-hidden="true" />
                        {isPostingComment
                          ? 'Sending...'
                          : replyRole === 'customer'
                          ? 'Send Reply'
                          : 'Post Note'}
                      </button>
                    </div>
                    {commentError && (
                      <p className="text-xs text-rose-700 font-medium">{commentError}</p>
                    )}
                  </form>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl p-6 text-sm text-slate-500">
              Select a ticket from the queue to inspect or update it.
            </div>
          )}

          {/* Live Pydantic Parameter Trace Panel */}
          <PydanticTracePanel trace={lastTrace} />
        </div>
      </div>

      {/* Create Ticket Modal */}
      {isModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setIsModalOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-ticket-title"
            className="bg-white border border-slate-200 rounded-xl max-w-lg w-full p-6 space-y-5 shadow-xl max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-4 pb-3 border-b border-slate-200">
              <div>
                <h2
                  id="create-ticket-title"
                  className="font-display text-lg font-bold text-slate-900"
                >
                  {formParentTicketId
                    ? `Create Follow-up Ticket (${formParentTicketId})`
                    : 'Create Support Ticket'}
                </h2>
                <p className="text-xs text-slate-500 font-mono">
                  POST /api/tickets -&gt; TicketCreate + Gemini Auto-Reply
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                aria-label="Close modal"
                className="p-1.5 text-slate-400 hover:text-slate-900 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>

            {formParentTicketId && (
              <div className="p-3 rounded-lg bg-sky-50 border border-sky-200 flex items-center justify-between gap-2 text-xs text-sky-900">
                <span>
                  Linked to auto-closed ticket{' '}
                  <span className="font-mono font-semibold">{formParentTicketId}</span>
                </span>
                <button
                  type="button"
                  onClick={() => setFormParentTicketId(null)}
                  className="text-sky-700 hover:underline font-medium cursor-pointer"
                >
                  Unlink
                </button>
              </div>
            )}

            <form onSubmit={handleCreateSubmit} className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label
                    htmlFor="ticket-title"
                    className="text-xs font-semibold text-slate-700"
                  >
                    title: str
                  </label>
                  <span className="text-xs font-mono text-slate-500">
                    Field(min_length=4, max_length=120)
                  </span>
                </div>
                <input
                  id="ticket-title"
                  type="text"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder="e.g. Webhook retries fail on 502 gateway timeout"
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-600"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label
                    htmlFor="ticket-email"
                    className="text-xs font-semibold text-slate-700"
                  >
                    requester_email: str
                  </label>
                  <span className="text-xs font-mono text-slate-500">
                    pattern=email
                  </span>
                </div>
                <input
                  id="ticket-email"
                  type="text"
                  value={formEmail}
                  onChange={(e) => setFormEmail(e.target.value)}
                  placeholder="alex@company.com"
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-600"
                />
              </div>

              <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={omitOptionalDefaults}
                  onChange={(e) => setOmitOptionalDefaults(e.target.checked)}
                  className="rounded border-slate-300 text-sky-700 focus:ring-sky-600"
                />
                <span>
                  Omit <code className="font-mono">priority</code> and{' '}
                  <code className="font-mono">category</code> from HTTP body to let Pydantic apply defaults
                </span>
              </label>

              {!omitOptionalDefaults && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label
                        htmlFor="ticket-priority"
                        className="text-xs font-semibold text-slate-700"
                      >
                        priority
                      </label>
                      <span className="text-xs font-mono text-slate-500">default="medium"</span>
                    </div>
                    <select
                      id="ticket-priority"
                      value={formPriority}
                      onChange={(e) => setFormPriority(e.target.value as TicketPriority)}
                      className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-600"
                    >
                      <option value="low">low</option>
                      <option value="medium">medium</option>
                      <option value="high">high</option>
                      <option value="urgent">urgent</option>
                    </select>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label
                        htmlFor="ticket-category"
                        className="text-xs font-semibold text-slate-700"
                      >
                        category
                      </label>
                      <span className="text-xs font-mono text-slate-500">default="bug"</span>
                    </div>
                    <select
                      id="ticket-category"
                      value={formCategory}
                      onChange={(e) => setFormCategory(e.target.value as TicketCategory)}
                      className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-600"
                    >
                      <option value="bug">bug</option>
                      <option value="billing">billing</option>
                      <option value="feature">feature</option>
                      <option value="account">account</option>
                    </select>
                  </div>
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label
                    htmlFor="ticket-desc"
                    className="text-xs font-semibold text-slate-700"
                  >
                    description: str
                  </label>
                  <span className="text-xs font-mono text-slate-500">
                    Field(min_length=10, max_length=2000)
                  </span>
                </div>
                <textarea
                  id="ticket-desc"
                  rows={3}
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder="Describe the steps to reproduce or impact..."
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-600"
                />
              </div>

              {formErrors.length > 0 && (
                <div className="p-3.5 rounded-lg border border-rose-200 bg-rose-50 space-y-1.5">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-rose-800">
                    <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span>HTTP 422 · Pydantic ValidationError</span>
                  </div>
                  <ul className="space-y-1">
                    {formErrors.map((err, i) => (
                      <li key={i} className="text-xs font-mono text-rose-800">
                        <span className="font-semibold">{err.loc.join('.')}:</span> {err.msg}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="pt-2 flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={fillInvalidTest}
                  className="px-3 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                >
                  Test 422 Error
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="px-4 py-2 text-sm font-semibold text-white bg-sky-700 hover:bg-sky-800 rounded-lg transition-colors whitespace-nowrap cursor-pointer disabled:opacity-50"
                  >
                    {isSubmitting ? 'Opening & Auto-Replying...' : 'Submit Ticket'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
};
