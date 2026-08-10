import type { SemanticContextRecord } from "./types";

export const SEMANTIC_CONTEXT_RECORDS: SemanticContextRecord[] = [
  {
    id: "auth.phone-login",
    audiences: ["business_user", "operator", "support", "admin", "developer"],
    productArea: "Authentication",
    capability: "Phone login",
    plainSummary:
      "Lets an Arden user prove their identity with a phone verification step before accessing their allowed companies and workspaces.",
    workflowSteps: [
      "The user starts a login or connection request.",
      "The user verifies their phone number with an OTP or trusted verification provider.",
      "Arden confirms the user and shows the companies or workspaces they can access.",
      "The selected access is used for future requests until the session needs renewal.",
    ],
    commonQuestions: [
      "How does Arden login work?",
      "Why do users need OTP?",
      "How does ChatGPT or another assistant connect to Arden safely?",
    ],
    relatedConcepts: ["OTP", "user identity", "session", "company access"],
    dataUse:
      "Use live data only to confirm the current user, available permissions, and selected company context.",
    responseGuidance:
      "For non-technical users, explain this as secure phone verification and company selection. Avoid implementation details unless the user is a developer.",
    internalPointerId: "auth.phoneLogin",
  },
  {
    id: "auth.mcp-connect",
    audiences: ["business_user", "operator", "support", "admin", "developer"],
    productArea: "Authentication",
    capability: "Connect AI assistant",
    plainSummary:
      "Allows an Arden user to connect an approved AI assistant to their Arden account without giving that assistant direct Arden passwords or private Arden tokens.",
    workflowSteps: [
      "The assistant asks Arden for permission to connect.",
      "The user logs in through Arden and confirms the connection.",
      "The user chooses which company or workspace the assistant should use.",
      "The assistant receives limited access to Arden tools through the Arden connection service.",
    ],
    commonQuestions: [
      "Can I use Arden inside ChatGPT?",
      "Is it safe to connect an AI assistant?",
      "Can the assistant access everything?",
    ],
    relatedConcepts: ["AI assistant", "permission grant", "limited access", "company selection"],
    dataUse:
      "Use live data only after the user has authenticated and selected the relevant Arden permission context.",
    responseGuidance:
      "Describe this as a secure connection and consent flow. Do not mention authorization codes, tokens, or internal endpoints for non-developer users.",
    internalPointerId: "auth.mcpConnection",
  },
  {
    id: "auth.session-renewal",
    audiences: ["business_user", "operator", "support", "admin", "developer"],
    productArea: "Authentication",
    capability: "Session renewal",
    plainSummary:
      "Keeps a verified Arden connection active for a reasonable time so users do not need to reconnect for every question or task.",
    workflowSteps: [
      "Arden confirms that the user has a valid connection.",
      "When short-term access expires, Arden renews it using the private server-side session.",
      "If renewal fails, the user is asked to connect again.",
    ],
    commonQuestions: [
      "Why did I need to reconnect?",
      "How long does the AI assistant stay connected?",
      "What happens when access expires?",
    ],
    relatedConcepts: ["session", "reconnect", "secure renewal"],
    dataUse:
      "Use live session checks to decide whether the user can continue or needs to reconnect.",
    responseGuidance:
      "Explain in simple terms that secure connections expire and may need renewal. Developer-only answers may discuss token renewal at a high level without exposing secrets.",
    internalPointerId: "auth.sessionRenewal",
  },
  {
    id: "permissions.company-access",
    audiences: ["business_user", "operator", "support", "admin", "developer"],
    productArea: "Permissions",
    capability: "Company and role access",
    plainSummary:
      "Controls which company, property, and features a user can see or act on in Arden.",
    workflowSteps: [
      "Arden identifies the user.",
      "Arden lists the companies or workspaces assigned to the user.",
      "The user or system selects the active access context.",
      "All live data and actions are limited to that selected context.",
    ],
    commonQuestions: [
      "Why can I not see a company?",
      "Why does the assistant show data for only one company?",
      "How does Arden decide what I can access?",
    ],
    relatedConcepts: ["company", "permission", "role", "workspace"],
    dataUse:
      "Always respect the user's selected company and permission context when reading live data.",
    responseGuidance:
      "Use business words like company, workspace, role, and access. Avoid low-level permission headers unless the user is a developer.",
    internalPointerId: "permissions.companyAccess",
  },
  {
    id: "live-data.role-aware-explanations",
    audiences: ["business_user", "operator", "support", "admin", "developer"],
    productArea: "Live Data",
    capability: "Role-aware explanation",
    plainSummary:
      "Turns current Arden data into an explanation that matches the user's role and level of technical comfort.",
    workflowSteps: [
      "Understand what the user is asking.",
      "Fetch only the live Arden data needed to answer.",
      "Summarize the facts clearly.",
      "Use a simple, operational, support, admin, or developer explanation style depending on the audience.",
    ],
    commonQuestions: [
      "What is happening with this booking?",
      "Why is this payment pending?",
      "Explain this resident's status in simple terms.",
    ],
    relatedConcepts: ["live data", "summary", "audience", "next steps"],
    dataUse:
      "Live data may be read through approved read-only tools, but raw JSON should not be shown to non-technical users by default.",
    responseGuidance:
      "For business users, provide plain summaries and next steps. For developers, include field names or API behavior only when explicitly useful.",
    internalPointerId: "liveData.roleAwareExplanation",
  },
  {
    id: "booking.lifecycle",
    audiences: ["business_user", "operator", "support", "admin"],
    productArea: "Bookings",
    capability: "Booking lifecycle",
    plainSummary:
      "Tracks the main operational flow around a booking, from creating or reviewing the booking through room assignment, commercials, move-in, stay management, and closure.",
    workflowSteps: [
      "Start with the booking record as the primary operational object.",
      "Review the person, company, property, room or bed, stay dates, and booking status from the booking context.",
      "Confirm availability and assign or verify the room or bed.",
      "Check commercials such as rent, deposit, discounts, fees, invoices, and payment plan if applicable.",
      "Confirm required documents, KYC, or contract readiness where the process requires it.",
      "Move the booking forward into move-in, active stay management, extension, room change, move-out, or closure as appropriate.",
    ],
    commonQuestions: [
      "What stage is this booking in?",
      "What should I do next for this booking?",
      "Why is this booking blocked?",
    ],
    relatedConcepts: [
      "booking-first workflow",
      "room assignment",
      "commercials",
      "payment plan",
      "documents",
      "move-in",
      "move-out",
    ],
    dataUse:
      "Use live booking data first, then add payment, room, document, and person context only when needed for the question.",
    responseGuidance:
      "Explain booking as the main workflow. Do not present lead or resident modules as the normal starting point; those may exist as supporting or older concepts, but admin explanations should be booking-first.",
    internalPointerId: "booking.lifecycle",
  },
  {
    id: "booking.payment-plan-relationship",
    audiences: ["business_user", "operator", "support", "admin", "developer"],
    productArea: "Bookings",
    capability: "Booking and payment plan relationship",
    plainSummary:
      "A booking represents the resident's stay or commitment, while the payment plan explains how the money for that booking is expected to be collected over time.",
    workflowSteps: [
      "A booking captures the stay/agreement context, including who the booking is for, where the stay is, and the commercial terms.",
      "Expected charges from the booking are arranged into a payment schedule when the team needs planned collections.",
      "The payment plan helps the team see what should be paid now, what is due later, and what is overdue.",
      "Actual payments are compared with the payment plan to understand collection progress for the booking.",
      "When explaining a booking's money status, combine booking context, payment plan schedule, invoices, and actual payment activity.",
    ],
    commonQuestions: [
      "How is a booking related to a payment plan?",
      "Why does this booking have pending payments?",
      "What does this resident need to pay for this booking?",
      "Is this booking's payment schedule on track?",
    ],
    relatedConcepts: [
      "booking",
      "stay agreement",
      "expected charges",
      "payment schedule",
      "invoice",
      "collection progress",
    ],
    dataUse:
      "For live answers, read booking details together with payment plan, invoice, and payment records before summarizing payment status.",
    responseGuidance:
      "For non-technical users, say the booking is the stay/agreement and the payment plan is the collection schedule for that booking. Avoid internal identifiers and raw fields unless the user is a developer.",
    internalPointerId: "relationships.bookingPaymentPlan",
  },
  {
    id: "payments.collection-status",
    audiences: ["business_user", "operator", "support", "admin", "developer"],
    productArea: "Payments",
    capability: "Collection and payment status",
    plainSummary:
      "Helps teams understand whether money is due, paid, pending, failed, or needs follow-up.",
    workflowSteps: [
      "Check what amount is expected and by when.",
      "Compare expected payments with received or attempted payments.",
      "Identify overdue, pending, failed, or successful payment situations.",
      "Suggest an appropriate follow-up such as reminder, review, or reconciliation.",
    ],
    commonQuestions: [
      "Why is this payment pending?",
      "Who has overdue payments?",
      "What needs collection follow-up today?",
    ],
    relatedConcepts: ["invoice", "payment plan", "transaction", "settlement", "reminder"],
    dataUse:
      "Use live payment, invoice, transaction, and booking context together before summarizing money-related questions.",
    responseGuidance:
      "For non-technical users, talk about due, paid, pending, failed, and follow-up. Avoid gateway internals unless the user is a developer or finance operator asking for detail.",
    internalPointerId: "payments.collectionStatus",
  },
  {
    id: "payments.payment-plan",
    audiences: ["business_user", "operator", "support", "admin", "developer"],
    productArea: "Payments",
    capability: "Payment plans",
    plainSummary:
      "Breaks expected charges into scheduled amounts so teams can track what should be collected over time.",
    workflowSteps: [
      "A booking or resident has expected charges.",
      "Those charges are arranged into a payment schedule.",
      "Actual payments are compared against the schedule.",
      "Missed or delayed scheduled payments are highlighted for follow-up.",
    ],
    commonQuestions: [
      "What does this resident need to pay next?",
      "Is this payment plan on track?",
      "Why is a scheduled payment overdue?",
    ],
    relatedConcepts: ["installment", "due date", "invoice", "collection"],
    dataUse:
      "Use live payment plan data together with actual payments and invoices for accurate status.",
    responseGuidance:
      "Explain payment plans as scheduled dues and collection progress. Developer details should be separated from business summaries.",
    internalPointerId: "payments.paymentPlan",
  },
  {
    id: "requests.module-overview",
    audiences: ["business_user", "operator", "support", "admin", "developer"],
    productArea: "Requests",
    capability: "Request module overview",
    plainSummary:
      "The request module is where resident or operational issues are recorded, tracked, assigned, followed up, and closed.",
    workflowSteps: [
      "A resident, lead, or team member raises a request when something needs attention.",
      "The request is categorized so the team understands what kind of help or action is needed.",
      "The request can be assigned to the right person or team for follow-up.",
      "Status and priority help the team see whether the request is new, pending, in progress, escalated, or resolved.",
      "The module helps support and operations avoid losing track of resident issues or internal tasks.",
    ],
    commonQuestions: [
      "What does the request module do?",
      "How are resident issues tracked?",
      "What does an escalated request mean?",
      "Who should handle this request?",
    ],
    relatedConcepts: [
      "resident issue",
      "support ticket",
      "assignment",
      "priority",
      "escalation",
      "resolution",
    ],
    dataUse:
      "For live answers, use request status, category, priority, assignment, resident context, and recent history to explain what needs attention.",
    responseGuidance:
      "For business users, explain requests as trackable issues or tasks. For support users, focus on what happened, current status, ownership, and the next follow-up.",
    internalPointerId: "requests.moduleOverview",
  },
  {
    id: "resident.profile-status",
    audiences: ["business_user", "operator", "support", "admin"],
    productArea: "Residents",
    capability: "Resident profile and status",
    plainSummary:
      "Brings together resident identity, contact, stay, room, payment, and service context so teams can understand the resident's current situation.",
    workflowSteps: [
      "Identify the resident or user record.",
      "Review current stay, booking, room, and company context.",
      "Check connected operational information such as payments, requests, or documents.",
      "Summarize the resident status and likely next step.",
    ],
    commonQuestions: [
      "What is this resident's current status?",
      "Why is this resident blocked?",
      "What should support tell this resident?",
    ],
    relatedConcepts: ["resident", "profile", "stay", "room", "support"],
    dataUse:
      "Use only the relevant resident and company-scoped live data required for the question.",
    responseGuidance:
      "Answer in customer-friendly language for support and business users. Avoid exposing internal identifiers unless needed by operators.",
    internalPointerId: "resident.profileStatus",
  },
  {
    id: "requests.resident-relationship",
    audiences: ["business_user", "operator", "support", "admin"],
    productArea: "Requests",
    capability: "Request and resident relationship",
    plainSummary:
      "Requests are often connected to a resident or booking so the team can understand who needs help and what context matters.",
    workflowSteps: [
      "A request is raised about a resident, stay, room, payment, service, or operational issue.",
      "Resident and booking context helps the team understand the impact and urgency.",
      "The request status shows whether the issue is waiting, being handled, escalated, or resolved.",
      "Support can use this context to give the resident a clearer update.",
    ],
    commonQuestions: [
      "How is this request connected to the resident?",
      "What should support tell the resident?",
      "Does this request affect the resident's stay?",
    ],
    relatedConcepts: ["resident", "booking", "support update", "issue context", "follow-up"],
    dataUse:
      "For live answers, combine request status with resident, booking, room, payment, or service context only as needed for the question.",
    responseGuidance:
      "Explain the connection in plain terms: who is affected, what the issue is, who owns it, and what should happen next.",
    internalPointerId: "relationships.requestResident",
  },
  {
    id: "requests.service-requests",
    audiences: ["business_user", "operator", "support", "admin"],
    productArea: "Requests",
    capability: "Service requests",
    plainSummary:
      "Tracks resident or operational requests so teams can follow up, assign responsibility, and close issues.",
    workflowSteps: [
      "A request is raised by a resident or team member.",
      "The request is categorized and assigned if needed.",
      "The team tracks status, priority, and response progress.",
      "The request is resolved or escalated based on the situation.",
    ],
    commonQuestions: [
      "Which requests need attention?",
      "Why is this request escalated?",
      "Who should handle this request next?",
    ],
    relatedConcepts: ["ticket", "issue", "assignment", "escalation", "resolution"],
    dataUse:
      "Use live request status, resident/company context, assignment, and history when explaining request state.",
    responseGuidance:
      "Prefer plain next-action language: pending, assigned, needs follow-up, resolved, escalated.",
    internalPointerId: "requests.serviceRequests",
  },
  {
    id: "comms.messages-and-notices",
    audiences: ["business_user", "operator", "support", "admin", "developer"],
    productArea: "Communications",
    capability: "Messages, notices, and reminders",
    plainSummary:
      "Supports communication with residents, leads, and teams through reminders, notices, email, WhatsApp, or other channels.",
    workflowSteps: [
      "Identify the audience and message purpose.",
      "Choose the appropriate communication channel.",
      "Send or schedule the message.",
      "Track whether follow-up is needed based on the business process.",
    ],
    commonQuestions: [
      "Was a reminder sent?",
      "How do we notify residents?",
      "What message should be sent next?",
    ],
    relatedConcepts: ["WhatsApp", "email", "notice", "reminder", "template"],
    dataUse:
      "Use live communication status only when needed to confirm whether a message or reminder exists.",
    responseGuidance:
      "For business users, describe communication outcome and next step. For developers, high-level channel behavior is okay, but avoid source implementation details unless authorized.",
    internalPointerId: "comms.messagesAndNotices",
  },
  {
    id: "contracts.documents",
    audiences: ["business_user", "operator", "support", "admin"],
    productArea: "Documents",
    capability: "Contracts and documents",
    plainSummary:
      "Helps teams prepare, track, refresh, or review documents connected to residents, bookings, or companies.",
    workflowSteps: [
      "Identify the resident, booking, or company document need.",
      "Generate or retrieve the relevant document.",
      "Check whether it is complete, refreshed, signed, or needs action.",
      "Explain the document status and next step.",
    ],
    commonQuestions: [
      "Is the contract ready?",
      "Why is a document missing?",
      "What document needs action?",
    ],
    relatedConcepts: ["contract", "template", "file", "signature", "refresh"],
    dataUse:
      "Use live document metadata and related booking/resident context. Avoid exposing private file contents unless explicitly authorized.",
    responseGuidance:
      "Summarize document readiness and next action in plain terms.",
    internalPointerId: "documents.contracts",
  },
  {
    id: "rooms.occupancy",
    audiences: ["business_user", "operator", "support", "admin"],
    productArea: "Rooms",
    capability: "Rooms, beds, and occupancy",
    plainSummary:
      "Shows how rooms and beds are allocated, available, occupied, or connected to bookings and residents.",
    workflowSteps: [
      "Review the property, room, or bed context.",
      "Check availability and occupancy status.",
      "Connect room status with resident and booking information.",
      "Explain availability, conflict, or next action.",
    ],
    commonQuestions: [
      "Which rooms are available?",
      "Why is this bed not assignable?",
      "Who is currently occupying this room?",
    ],
    relatedConcepts: ["property", "room", "bed", "occupancy", "allocation"],
    dataUse:
      "Use live room, bed, property, booking, and resident data together when explaining occupancy.",
    responseGuidance:
      "Explain as availability and assignment status. Avoid database field names for non-technical users.",
    internalPointerId: "rooms.occupancy",
  },
  {
    id: "operations.tasks-and-sessions",
    audiences: ["business_user", "operator", "support", "admin"],
    productArea: "Operations",
    capability: "Tasks and operational sessions",
    plainSummary:
      "Helps teams coordinate recurring or one-off work, assign responsibilities, and monitor completion.",
    workflowSteps: [
      "A task or operational session is created or scheduled.",
      "The responsible team or person is assigned.",
      "Progress and completion are tracked.",
      "Delays, missing assignments, or overdue work are highlighted.",
    ],
    commonQuestions: [
      "What work is pending today?",
      "Who owns this task?",
      "Why is this activity delayed?",
    ],
    relatedConcepts: ["task", "assignment", "session", "status", "completion"],
    dataUse:
      "Use live task/session status, assignment, due dates, and related property or resident context.",
    responseGuidance:
      "Return practical operational next steps, not implementation details.",
    internalPointerId: "operations.tasksAndSessions",
  },
  {
    id: "analytics.reports",
    audiences: ["business_user", "operator", "admin"],
    productArea: "Analytics",
    capability: "Reports and dashboards",
    plainSummary:
      "Turns Arden activity and operational data into summaries that help teams understand performance, risk, and priorities.",
    workflowSteps: [
      "Choose the business area or metric.",
      "Collect relevant current or historical data.",
      "Summarize trends, exceptions, or priorities.",
      "Recommend what the team should review or act on next.",
    ],
    commonQuestions: [
      "What needs attention today?",
      "How are collections performing?",
      "What changed this week?",
    ],
    relatedConcepts: ["dashboard", "report", "trend", "exception", "priority"],
    dataUse:
      "Use live data for current operational summaries and historical data for trends when available.",
    responseGuidance:
      "For business users, focus on what changed, why it matters, and what to do next.",
    internalPointerId: "analytics.reports",
  },
  {
    id: "developer.implementation-context",
    audiences: ["developer"],
    productArea: "Developer Context",
    capability: "Implementation-oriented explanation",
    plainSummary:
      "Helps developers move from a product or workflow question to the relevant private implementation context without storing source code in the semantic index.",
    workflowSteps: [
      "Use semantic context to identify the product area and capability.",
      "Use private local tools to resolve exact implementation details when developer access is allowed.",
      "Read only the bounded local source ranges needed for the answer.",
      "Explain the implementation with references only for developer-authorized users.",
    ],
    commonQuestions: [
      "Where is this implemented?",
      "What code path handles this workflow?",
      "How do I debug this behavior?",
    ],
    relatedConcepts: ["private code index", "bounded source read", "implementation", "debugging"],
    dataUse:
      "Use local/private code tools for exact implementation details. Do not rely on Qdrant Cloud for source code.",
    responseGuidance:
      "Only use technical details for developer-authorized answers. Keep business users on plain summaries.",
    internalPointerId: "developer.implementationContext",
  },
];
