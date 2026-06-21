import type { Activity } from "shared";
import { relativeTime } from "../utils";
import { describeActivity, type ActivityScope } from "../activity";

interface Props {
  activity: Activity;
  scope: ActivityScope;
}

export function ActivityLine({ activity, scope }: Props) {
  const { icon: Icon, text } = describeActivity(activity, scope);
  return (
    <div className="flex items-start gap-2 text-sm text-slate-600">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
      <p className="leading-snug">
        <span className="font-semibold text-slate-700">{activity.actor.handle}</span> {text}{" "}
        <span className="text-xs text-slate-400">{relativeTime(activity.createdAt)}</span>
      </p>
    </div>
  );
}
