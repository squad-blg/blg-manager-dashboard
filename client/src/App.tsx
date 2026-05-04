import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "./lib/theme";
import Dashboard from "./pages/Dashboard";
import ClientsPage from "./pages/Clients";
import SettingsPage from "./pages/Settings";
import NotFound from "./pages/not-found";

export default function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <Router hook={useHashLocation}>
          <Switch>
            <Route path="/" component={Dashboard} />
            <Route path="/clients" component={ClientsPage} />
            <Route path="/settings" component={SettingsPage} />
            <Route component={NotFound} />
          </Switch>
        </Router>
        <Toaster />
      </QueryClientProvider>
    </ThemeProvider>
  );
}
