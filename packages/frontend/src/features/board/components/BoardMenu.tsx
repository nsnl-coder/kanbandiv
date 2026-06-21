import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  MoreHorizontal,
  Pencil,
  History,
  Tag,
  LayoutTemplate,
  Archive,
  Users,
  Maximize2,
  Minimize2,
  Check,
} from "lucide-react";

interface Props {
  editable: boolean;
  owner: boolean;
  wide: boolean;
  onToggleWide: () => void;
  onEdit: () => void;
  onHistory: () => void;
  onLabels: () => void;
  onTemplates: () => void;
  onArchived: () => void;
  onAccess: () => void;
  onArchive: () => void;
}

const ITEM =
  "flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm font-medium text-slate-700 outline-none transition-colors data-[highlighted]:bg-slate-100";

const ICON = "h-4 w-4 text-slate-400";

export function BoardMenu({
  editable,
  owner,
  wide,
  onToggleWide,
  onEdit,
  onHistory,
  onLabels,
  onTemplates,
  onArchived,
  onAccess,
  onArchive,
}: Props) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="flex items-center gap-1.5 rounded-xl border border-slate-200/80 bg-white/70 px-3 py-2 font-medium text-slate-600 shadow-[0_1px_2px_rgb(15_23_42/0.04)] backdrop-blur-sm transition-all duration-200 hover:border-slate-300 hover:bg-white hover:text-slate-900 active:scale-[0.97] data-[state=open]:border-slate-300 data-[state=open]:bg-white">
        <MoreHorizontal className="h-4 w-4" />
        Board menu
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="z-30 w-60 origin-top-right rounded-2xl border border-slate-200/80 bg-white/95 p-1.5 shadow-[0_16px_40px_-12px_rgb(15_23_42/0.30)] backdrop-blur-md"
        >
          <DropdownMenu.Item className={ITEM} onSelect={onToggleWide}>
            {wide ? <Minimize2 className={ICON} /> : <Maximize2 className={ICON} />}
            <span className="flex-1">{wide ? "Fit to screen" : "Full width"}</span>
            {wide ? <Check className="h-4 w-4 text-indigo-500" /> : null}
          </DropdownMenu.Item>

          <DropdownMenu.Item className={ITEM} onSelect={onHistory}>
            <History className={ICON} />
            Activity history
          </DropdownMenu.Item>

          {editable ? (
            <>
              <DropdownMenu.Separator className="my-1.5 h-px bg-slate-100" />
              <DropdownMenu.Item className={ITEM} onSelect={onEdit}>
                <Pencil className={ICON} />
                Edit board details
              </DropdownMenu.Item>
              <DropdownMenu.Item className={ITEM} onSelect={onLabels}>
                <Tag className={ICON} />
                Manage labels
              </DropdownMenu.Item>
              <DropdownMenu.Item className={ITEM} onSelect={onTemplates}>
                <LayoutTemplate className={ICON} />
                Card templates
              </DropdownMenu.Item>
              <DropdownMenu.Item className={ITEM} onSelect={onArchived}>
                <Archive className={ICON} />
                Archived items
              </DropdownMenu.Item>
            </>
          ) : null}

          {owner ? (
            <>
              <DropdownMenu.Separator className="my-1.5 h-px bg-slate-100" />
              <DropdownMenu.Item className={ITEM} onSelect={onAccess}>
                <Users className={ICON} />
                Manage access
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm font-medium text-rose-600 outline-none transition-colors data-[highlighted]:bg-rose-50"
                onSelect={onArchive}
              >
                <Archive className="h-4 w-4" />
                Archive board
              </DropdownMenu.Item>
            </>
          ) : null}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
