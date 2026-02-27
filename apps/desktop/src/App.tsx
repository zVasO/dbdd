import { useConnectionStore } from "@/stores/connectionStore";
import { WelcomePage } from "@/pages/WelcomePage";
import { WorkspacePage } from "@/pages/WorkspacePage";

function App() {
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId);

  return activeConnectionId ? <WorkspacePage /> : <WelcomePage />;
}

export default App;
