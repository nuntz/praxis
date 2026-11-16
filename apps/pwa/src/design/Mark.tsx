import Hammer from "lucide-solid/icons/hammer";

/**
 * Praxis's mark beside its name: the app icon's hammer on its tile, inverting with the theme. It
 * stands for the whole Deployment, so it never takes a Context's accent.
 */
export function Mark() {
  return (
    <span class="mark" aria-hidden="true">
      <Hammer size={20} stroke-width={2.2} />
    </span>
  );
}
