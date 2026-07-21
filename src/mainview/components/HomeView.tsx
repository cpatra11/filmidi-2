import { useState } from "react";
import { useProjectStore, type ProjectEntry } from "@/store/useProjectStore";
import { useAppStore } from "@/store/useAppStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { NewProjectDialog } from "./NewProjectDialog";
import { Button } from "@/components/ui/button";
import { Film, Plus, Search, Trash2, MoreHorizontal, FolderOpen, User, KeyRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { SettingsDialog } from "./SettingsDialog";

function formatRelativeDate(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

function ProjectCard({
  project,
  onOpen,
  onDelete,
  onRename,
}: {
  project: ProjectEntry;
  onOpen: () => void;
  onDelete: () => void;
  onRename: (name: string) => void;
}) {
  const [isHovered, setIsHovered] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(project.name);

  return (
    <div
      className="relative group cursor-pointer"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => {
        setIsHovered(false);
        setShowMenu(false);
      }}
      onClick={onOpen}
    >
      <div
        className={cn(
          "relative aspect-[5/4] rounded-lg overflow-hidden transition-all duration-200",
          "border border-white/10 hover:border-white/20",
          "hover:scale-[1.03] hover:shadow-xl",
          isHovered && "ring-2 ring-white/20"
        )}
      >
        {/* Thumbnail */}
        <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-white/10">
          {project.thumbnailUrl ? (
            <img
              src={project.thumbnailUrl}
              alt={project.name}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="flex items-center justify-center w-full h-full">
              <Film className="w-12 h-12 text-white/20" />
            </div>
          )}
        </div>

        {/* Bottom gradient */}
        <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-black/70 to-transparent" />

        {/* Project info */}
        <div className="absolute bottom-0 left-0 right-0 p-3">
          {isEditing ? (
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={() => {
                if (editName.trim()) onRename(editName.trim());
                setIsEditing(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  if (editName.trim()) onRename(editName.trim());
                  setIsEditing(false);
                }
                if (e.key === "Escape") setIsEditing(false);
              }}
              className="w-full bg-black/50 text-white text-sm px-2 py-1 rounded border border-white/20 outline-none"
              autoFocus
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <div className="text-white text-sm font-medium truncate">
              {project.name}
            </div>
          )}
          <div className="text-white/60 text-xs mt-0.5">
            {formatRelativeDate(project.lastOpenedAt)}
          </div>
        </div>

        {/* Hover actions */}
        {isHovered && !isEditing && (
          <div className="absolute top-2 right-2 flex gap-1">
            <button
              className="p-1.5 rounded-md bg-black/50 hover:bg-black/70 text-white/70 hover:text-white transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                setShowMenu(!showMenu);
              }}
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
            <button
              className="p-1.5 rounded-md bg-black/50 hover:bg-red-600/80 text-white/70 hover:text-white transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Context menu */}
        {showMenu && (
          <div
            className="absolute top-10 right-2 w-48 bg-zinc-900 border border-white/10 rounded-lg shadow-xl py-1 z-50"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="w-full px-3 py-2 text-left text-sm text-white/80 hover:bg-white/10 hover:text-white flex items-center gap-2"
              onClick={() => {
                onOpen();
                setShowMenu(false);
              }}
            >
              <FolderOpen className="w-4 h-4" />
              Open
            </button>
            <button
              className="w-full px-3 py-2 text-left text-sm text-white/80 hover:bg-white/10 hover:text-white flex items-center gap-2"
              onClick={() => {
                setIsEditing(true);
                setShowMenu(false);
              }}
            >
              Rename
            </button>
            <button
              className="w-full px-3 py-2 text-left text-sm text-white/80 hover:bg-white/10 hover:text-white flex items-center gap-2"
              onClick={() => {
                navigator.clipboard.writeText(window.location.href);
                setShowMenu(false);
              }}
            >
              Copy Link
            </button>
            <div className="h-px bg-white/10 my-1" />
            <button
              className="w-full px-3 py-2 text-left text-sm text-red-400 hover:bg-red-600/20 hover:text-red-300 flex items-center gap-2"
              onClick={() => {
                onDelete();
                setShowMenu(false);
              }}
            >
              <Trash2 className="w-4 h-4" />
              Delete Project
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function SampleCard({
  title,
  posterUrl,
  onDownload,
}: {
  title: string;
  posterUrl?: string;
  onDownload: () => void;
}) {
  return (
    <div
      className="flex-shrink-0 w-48 cursor-pointer group"
      onClick={onDownload}
    >
      <div className="relative aspect-[5/4] rounded-lg overflow-hidden border border-white/10 group-hover:border-white/20 transition-all group-hover:scale-[1.03] group-hover:shadow-xl">
        <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-white/10">
          {posterUrl ? (
            <img
              src={posterUrl}
              alt={title}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="flex items-center justify-center w-full h-full">
              <Film className="w-10 h-10 text-white/30" />
            </div>
          )}
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-black/70 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 p-2">
          <div className="text-white text-xs font-medium truncate">{title}</div>
        </div>
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="px-3 py-1.5 bg-white/20 backdrop-blur-sm rounded-full text-white text-xs font-medium">
            Download
          </div>
        </div>
      </div>
    </div>
  );
}

export function HomeView() {
  const { projects, addProject, openProject, deleteProject, renameProject, setShowNewProjectDialog } =
    useProjectStore();
  const { setProjectName } = useAppStore();
  const [searchQuery, setSearchQuery] = useState("");

  const sortedProjects = [...projects].sort(
    (a, b) => b.lastOpenedAt - a.lastOpenedAt
  );

  const filteredProjects = searchQuery
    ? sortedProjects.filter((p) =>
        p.name.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : sortedProjects;

  const handleNewProject = () => {
    setShowNewProjectDialog(true);
  };

  const handleCreateProject = (settings: { name: string; width: number; height: number; fps: number }) => {
    const id = addProject(settings.name, settings);
    setProjectName(settings.name);
    openProject(id);
  };

  const handleOpenProject = (project: ProjectEntry) => {
    openProject(project.id);
    setProjectName(project.name);
  };

  return (
    <div className="flex h-screen bg-[#050505] text-white">
      {/* Sidebar */}
      <div className="w-[220px] flex-shrink-0 border-r border-white/10 flex flex-col electrobun-webkit-app-region-drag">
        {/* Logo */}
        <div className="p-4 flex items-center gap-2 electrobun-webkit-app-region-no-drag">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-white to-white/80 flex items-center justify-center">
            <Film className="w-5 h-5 text-black" />
          </div>
          <span className="font-semibold text-lg">Filmidi</span>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-2 py-2 electrobun-webkit-app-region-no-drag">
          <button className="w-full px-3 py-2 rounded-lg bg-white/10 text-white text-sm font-medium flex items-center gap-2">
            <FolderOpen className="w-4 h-4" />
            Projects
          </button>
        </nav>

        {/* Footer */}
        <div className="p-4 border-t border-white/10 electrobun-webkit-app-region-no-drag">
          <AccountPopoverInHome />
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 flex items-center justify-between border-b border-white/10">
          <div>
            <h1 className="text-xl font-semibold">Welcome back</h1>
            <p className="text-sm text-white/50 mt-0.5">
              {projects.length === 0
                ? "Create your first project to get started"
                : `${projects.length} project${projects.length !== 1 ? "s" : ""}`}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
              <input
                type="text"
                placeholder="Search projects..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-64 pl-9 pr-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder:text-white/40 outline-none focus:border-white/20"
              />
            </div>
            <Button
              variant="outline"
              onClick={() => useSettingsStore.getState().openTab("agent")}
              className="border-white/15 text-white/75 hover:bg-white/10 hover:text-white"
            >
              <KeyRound className="w-4 h-4 mr-2" />
              Add API Key
            </Button>
            <Button
              onClick={handleNewProject}
              className="bg-white text-black hover:bg-white/90"
            >
              <Plus className="w-4 h-4 mr-2" />
              New Project
            </Button>
          </div>
        </div>

        {/* Sample projects strip */}
        <div className="px-6 py-4 border-b border-white/5">
          <h2 className="text-sm font-medium text-white/60 mb-3">
            Sample Projects
          </h2>
          <div className="flex gap-3 overflow-x-auto pb-2">
            <SampleCard
              title="Quick Tour"
              onDownload={() => {
                const id = addProject("Quick Tour");
                setProjectName("Quick Tour");
                openProject(id);
              }}
            />
            <SampleCard
              title="Caption Demo"
              onDownload={() => {
                const id = addProject("Caption Demo");
                setProjectName("Caption Demo");
                openProject(id);
              }}
            />
            <SampleCard
              title="Music Video"
              onDownload={() => {
                const id = addProject("Music Video");
                setProjectName("Music Video");
                openProject(id);
              }}
            />
          </div>
        </div>

        {/* My Projects */}
        <div className="flex-1 overflow-y-auto p-6">
          <h2 className="text-sm font-medium text-white/60 mb-4">
            My Projects
          </h2>

          {filteredProjects.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20">
              <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center mb-4">
                <Film className="w-8 h-8 text-white/20" />
              </div>
              <p className="text-white/40 text-sm">
                {searchQuery
                  ? "No projects match your search"
                  : "No projects yet. Click 'New Project' to get started."}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
              {/* New project card */}
              <div
                className="cursor-pointer group"
                onClick={handleNewProject}
              >
                <div className="aspect-[5/4] rounded-lg border-2 border-dashed border-white/20 group-hover:border-white/40 flex flex-col items-center justify-center transition-all group-hover:bg-white/5">
                  <Plus className="w-8 h-8 text-white/30 group-hover:text-white/50 mb-2" />
                  <span className="text-xs text-white/40 group-hover:text-white/60">
                    New Project
                  </span>
                </div>
              </div>

              {/* Project cards */}
              {filteredProjects.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  onOpen={() => handleOpenProject(project)}
                  onDelete={() => deleteProject(project.id)}
                  onRename={(name) => renameProject(project.id, name)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
      <NewProjectDialog
        open={useProjectStore.getState().showNewProjectDialog}
        onOpenChange={(open) => useProjectStore.getState().setShowNewProjectDialog(open)}
        onCreate={handleCreateProject}
      />
      <SettingsDialog />
    </div>
  );
}

function AccountPopoverInHome() {
  const { openTab } = useSettingsStore();

  return (
    <button onClick={() => openTab("agent")} className="flex items-center gap-2 text-xs text-white/40 hover:text-white/70 transition-colors cursor-pointer">
      <KeyRound className="w-3.5 h-3.5" />
      <span>Vercel API key</span>
    </button>
  );
}
