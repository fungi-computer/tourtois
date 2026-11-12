import type { HostNavigation } from "@fungi.computer/agar";
import { useHostNavigation } from "@fungi.computer/agar/react";
import { ActionRow } from "@fungi.computer/caps/components/action-row";
import { DataList, DataRow } from "@fungi.computer/caps/components/data-list";
import { SectionCard } from "@fungi.computer/caps/blocks/section-card";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  useCanGoBack,
  useNavigate,
  useRouterState,
  type RouterHistory,
} from "@tanstack/react-router";
import { useEffect, useState } from "react";

const seeds = [
  { id: "fern", name: "Fern", note: "Shade, damp soil, patience." },
  { id: "clover", name: "Clover", note: "Sun, any soil, spreads politely." },
  { id: "moss", name: "Moss", note: "Stone, mist, no hurry at all." },
] as const;

/**
 * TanStack Router can go forward but cannot say whether it can, so the demo
 * counts the steps Back has taken since the last push.
 */
function useCanGoForward(history: RouterHistory): boolean {
  const [steps, setSteps] = useState(0);
  useEffect(
    () =>
      history.subscribe(({ action }) => {
        setSteps((current) => {
          if (action.type === "PUSH") return 0;
          if (action.type === "BACK") return current + 1;
          if (action.type === "FORWARD") return Math.max(0, current - 1);
          return current;
        });
      }),
    [history],
  );
  return steps > 0;
}

/**
 * The TanStack Router recipe: memory history, so the browser's own history
 * never moves, and the router's back stack drives the host's Back.
 */
function HostBack({
  navigation,
  history,
}: {
  navigation: HostNavigation;
  history: RouterHistory;
}) {
  const canGoBack = useCanGoBack();
  const canGoForward = useCanGoForward(history);
  const title = useRouterState({
    select: (state) => {
      const seed = seeds.find(
        (item) => state.location.pathname === `/seeds/${item.id}`,
      );
      return seed?.name;
    },
  });
  useHostNavigation(navigation, {
    canGoBack,
    canGoForward,
    onForward: () => {
      if (!canGoForward) return false;
      history.forward();
      return true;
    },
    title,
    onBack: () => {
      if (!history.canGoBack()) return false;
      history.back();
      return true;
    },
  });
  return null;
}

function SeedList() {
  const navigate = useNavigate();
  return (
    <SectionCard heading="Seeds" description="Pick one to read about it.">
      <DataList aria-label="Seeds">
        {seeds.map((seed) => (
          <DataRow key={seed.id}>
            <ActionRow
              label={seed.name}
              description={seed.note}
              onClick={() => {
                void navigate({
                  to: "/seeds/$seedId",
                  params: { seedId: seed.id },
                });
              }}
            />
          </DataRow>
        ))}
      </DataList>
    </SectionCard>
  );
}

function SeedDetail() {
  const seedId = useRouterState({
    select: (state) => state.location.pathname.split("/").at(-1),
  });
  const seed = seeds.find((item) => item.id === seedId);
  return (
    <SectionCard
      heading={seed?.name ?? "Unknown seed"}
      description={seed?.note ?? "This seed is not in the packet."}
    />
  );
}

function createPagesRouter(navigation: HostNavigation) {
  const history = createMemoryHistory({ initialEntries: ["/"] });
  const root = createRootRoute({
    component: () => (
      <div className="tourtois-pages-demo">
        <HostBack navigation={navigation} history={history} />
        <Outlet />
      </div>
    ),
  });
  const list = createRoute({
    getParentRoute: () => root,
    path: "/",
    component: SeedList,
  });
  const detail = createRoute({
    getParentRoute: () => root,
    path: "/seeds/$seedId",
    component: SeedDetail,
  });
  return createRouter({
    routeTree: root.addChildren([list, detail]),
    history,
  });
}

/** A two-page demo App: a list and a detail page, Back in the window chrome. */
export function PagesDemo({ navigation }: { navigation: HostNavigation }) {
  const [router] = useState(() => createPagesRouter(navigation));
  return <RouterProvider router={router} />;
}
