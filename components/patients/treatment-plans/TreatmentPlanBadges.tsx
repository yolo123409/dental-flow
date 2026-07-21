import Badge from "@/components/ui/Badge";

import {
  TreatmentItemPriority,
  TreatmentItemStatus,
  TreatmentPlanStatus,
} from "@/types/treatmentPlan";

export function PlanStatusBadge({
  status,
}: {
  status: TreatmentPlanStatus;
}) {
  switch (status) {
    case "Draft":
      return <Badge color="gray">{status}</Badge>;

    case "Planned":
      return <Badge color="blue">{status}</Badge>;

    case "In Progress":
      return <Badge color="yellow">{status}</Badge>;

    case "Completed":
      return <Badge color="green">{status}</Badge>;

    case "Cancelled":
      return <Badge color="red">{status}</Badge>;
  }
}

export function ItemStatusBadge({
  status,
}: {
  status: TreatmentItemStatus;
}) {
  switch (status) {
    case "Planned":
      return <Badge color="blue">{status}</Badge>;

    case "In Progress":
      return <Badge color="yellow">{status}</Badge>;

    case "Completed":
      return <Badge color="green">{status}</Badge>;

    case "Cancelled":
      return <Badge color="red">{status}</Badge>;
  }
}

export function PriorityBadge({
  priority,
}: {
  priority: TreatmentItemPriority;
}) {
  switch (priority) {
    case "Low":
      return <Badge color="gray">Low</Badge>;

    case "Medium":
      return <Badge color="blue">Medium</Badge>;

    case "High":
      return <Badge color="red">High</Badge>;
  }
}
