import Badge from "./Badge";

interface StatusBadgeProps {
  status: string;
}

export default function StatusBadge({
  status,
}: StatusBadgeProps) {
  if (["Scheduled", "Ongoing", "Completed", "Cancelled", "Missed"].includes(status)) {
    return <Badge status={status as "Scheduled" | "Ongoing" | "Completed" | "Cancelled" | "Missed"}>{status}</Badge>;
  }
  switch (status) {
    case "Active":
      return (
        <Badge color="green">
          {status}
        </Badge>
      );

    case "Suspended":
      return (
        <Badge color="red">
          {status}
        </Badge>
      );

    case "Pending":
      return (
        <Badge color="yellow">
          {status}
        </Badge>
      );

    default:
      return (
        <Badge color="gray">
          {status}
        </Badge>
      );
  }
}
