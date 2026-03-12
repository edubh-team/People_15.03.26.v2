"use client";

export function NavIcon({
  name,
  className,
}: {
  name:
    | "home"
    | "dashboard"
    | "attendance"
    | "tasks"
    | "leads"
    | "reports"
    | "admin"
    | "settings"
    | "chat"
    | "users"
    | "recruitment"
    | "money";
  className?: string;
}) {
  const common = {
    className: className ?? "h-5 w-5",
    viewBox: "0 0 24 24",
    fill: "none",
    xmlns: "http://www.w3.org/2000/svg",
  };

  if (name === "users") {
    return (
      <svg {...common} stroke="currentColor" strokeWidth="1.8">
         <path d="M17 20c0-1.657-3.134-3-7-3S3 18.343 3 20" />
         <circle cx="10" cy="8" r="4" />
         <path d="M21 16.5c0-1.1-2.015-2-4.5-2" />
         <circle cx="16.5" cy="7.5" r="3.5" />
      </svg>
    );
  }

  if (name === "recruitment") {
    return (
      <svg {...common} stroke="currentColor" strokeWidth="1.8">
        <path d="M10 21h4" />
        <path d="M12 17v4" />
        <rect width="14" height="14" x="5" y="3" rx="2" />
        <path d="M9 10a2 2 0 1 1 4 0" />
        <path d="M9 14h6" />
      </svg>
    );
  }

  if (name === "money") {
    return (
      <svg {...common} stroke="currentColor" strokeWidth="1.8">
        <rect width="20" height="12" x="2" y="6" rx="2" />
        <circle cx="12" cy="12" r="2" />
        <path d="M6 12h.01M18 12h.01" />
      </svg>
    );
  }

  if (name === "home") {
    return (
      <svg {...common} stroke="currentColor" strokeWidth="1.8">
        <path d="M3 10.5 12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1v-10.5Z" />
      </svg>
    );
  }

  if (name === "dashboard") {
    return (
      <svg {...common} stroke="currentColor" strokeWidth="1.8">
        <path d="M4 13h7V4H4v9Zm9 7h7V11h-7v9ZM4 20h7v-5H4v5Zm9-9h7V4h-7v7Z" />
      </svg>
    );
  }

  if (name === "attendance") {
    return (
      <svg {...common} stroke="currentColor" strokeWidth="1.8">
        <path d="M7 3v3M17 3v3" />
        <path d="M4 7h16" />
        <path d="M6 21h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2Z" />
        <path d="M9 14l2 2 4-4" />
      </svg>
    );
  }

  if (name === "tasks") {
    return (
      <svg {...common} stroke="currentColor" strokeWidth="1.8">
        <path d="M9 6h12M9 12h12M9 18h12" />
        <path d="M4 6h.01M4 12h.01M4 18h.01" />
      </svg>
    );
  }

  if (name === "leads") {
    return (
      <svg {...common} stroke="currentColor" strokeWidth="1.8">
        <path d="M16 11a4 4 0 1 0-8 0 4 4 0 0 0 8 0Z" />
        <path d="M4 21a8 8 0 0 1 16 0" />
      </svg>
    );
  }

  if (name === "reports") {
    return (
      <svg {...common} stroke="currentColor" strokeWidth="1.8">
        <path d="M7 3h10a2 2 0 0 1 2 2v14l-4-2-3 2-3-2-4 2V5a2 2 0 0 1 2-2Z" />
        <path d="M9 7h6M9 11h6" />
      </svg>
    );
  }

  if (name === "chat") {
    return (
      <svg {...common} stroke="currentColor" strokeWidth="1.8">
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
      </svg>
    );
  }

  if (name === "admin") {
    return (
      <svg {...common} stroke="currentColor" strokeWidth="1.8">
        <path d="M12 2 20 6v6c0 5-3.5 9.5-8 10-4.5-.5-8-5-8-10V6l8-4Z" />
        <path d="M9 12h6" />
        <path d="M12 9v6" />
      </svg>
    );
  }

  return (
    <svg {...common} stroke="currentColor" strokeWidth="1.8">
      <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
      <path d="M19.4 15a7.96 7.96 0 0 0 .1-1 7.96 7.96 0 0 0-.1-1l2-1.5-2-3.5-2.3 1a7.9 7.9 0 0 0-1.7-1l-.3-2.5h-4l-.3 2.5a7.9 7.9 0 0 0-1.7 1l-2.3-1-2 3.5 2 1.5a7.96 7.96 0 0 0-.1 1c0 .34.03.67.1 1l-2 1.5 2 3.5 2.3-1a7.9 7.9 0 0 0 1.7 1l.3 2.5h4l.3-2.5a7.9 7.9 0 0 0 1.7-1l2.3 1 2-3.5-2-1.5Z" />
    </svg>
  );
}

export function BellIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className ?? "h-5 w-5"}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path d="M15 17H9" />
      <path d="M18 17V11a6 6 0 1 0-12 0v6l-2 2h16l-2-2Z" />
      <path d="M10 21a2 2 0 0 0 4 0" />
    </svg>
  );
}

export function MenuIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className ?? "h-5 w-5"}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

