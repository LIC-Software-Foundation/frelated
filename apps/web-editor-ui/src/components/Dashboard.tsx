import { useState } from 'react';
import { Plus, FileText, Users, Share, Folder, Menu, X } from 'lucide-react';
import ProjectEditor from './ProjectEditor';
import CollaboratorsList from './CollaboratorsList';
import { v4 as uuidv4 } from 'uuid';
import { User } from '@frelated/types'; // shared User type

// Project model
interface Project {
  id: string;
  name: string;
  files: string[];
  collaborators: User[];
  owner: string;
  createdAt: string;
}

// Props for Dashboard
interface DashboardProps {
  user: User;
  initialProjectId?: string;
  owner?: string;
}

// Props for ShareModal
interface ShareModalProps {
  showShareModal: boolean;
  setShowShareModal: React.Dispatch<React.SetStateAction<boolean>>;
  ownerEmail: string;
  projectId: string;
}

const ShareModal: React.FC<ShareModalProps> = ({
  showShareModal,
  setShowShareModal,
  ownerEmail,
  projectId,
}) => {
  const shareLink = `${window.location.origin}/project/${ownerEmail}/${projectId}`;

  const copyToClipboard = () => {
    navigator.clipboard.writeText(shareLink);
    alert('Link copied to clipboard!');
  };

  if (!showShareModal) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl p-6 w-full max-w-md">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold">Share Project</h3>
          <button
            onClick={() => setShowShareModal(false)}
            className="text-gray-400 hover:text-gray-600"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Share this link to allow users to access the project:
          </p>

          <div className="flex space-x-2">
            <input
              type="text"
              readOnly
              value={shareLink}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <button
              onClick={copyToClipboard}
              className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
            >
              Copy
            </button>
          </div>

          <button
            onClick={() => setShowShareModal(false)}
            className="w-full bg-gray-300 hover:bg-gray-400 text-gray-700 font-semibold py-2 px-4 rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

const Dashboard: React.FC<DashboardProps> = ({
  user,
  initialProjectId,
  owner,
}) => {
  const [projects, setProjects] = useState<Project[]>([
    {
      id: initialProjectId ?? uuidv4(),
      name: 'first project',
      files: ['main.tex', 'references.bib', 'figures.tex'],
      collaborators: [user],
      owner: user.email,
      createdAt: new Date().toISOString(),
    },
  ]);

  const [selectedProject, setSelectedProject] = useState<Project | undefined>(
    () => projects.find((p) => p.id === initialProjectId) || projects[0],
  );
  const [selectedFile, setSelectedFile] = useState<string>('main.tex');
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(true);
  const [showShareModal, setShowShareModal] = useState<boolean>(false);

  const createNewProject = () => {
    const projectName = prompt('Enter project name:');
    if (!projectName) return;

    const newProject: Project = {
      id: uuidv4(),
      name: projectName,
      files: ['main.tex'],
      collaborators: [user],
      owner: user.email,
      createdAt: new Date().toISOString(),
    };

    setProjects([...projects, newProject]);
    setSelectedProject(newProject);
    setSelectedFile('main.tex');
  };

  const addFileToProject = (projectId: string) => {
    const fileName = prompt('Enter file name (with extension):');
    if (!fileName) return;

    setProjects((prev) =>
      prev.map((project) =>
        project.id === projectId
          ? { ...project, files: [...project.files, fileName] }
          : project,
      ),
    );
  };

  return (
    <div className="h-screen bg-gray-50 flex">
      {/* Sidebar */}
      <div
        className={`bg-white border-r border-gray-200 flex-shrink-0 transition-all duration-300 ${
          sidebarOpen ? 'w-80' : 'w-0'
        } overflow-hidden`}
      >
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Projects</h2>
            <button
              onClick={createNewProject}
              className="p-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
              title="New Project"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-2">
            {projects.map((project) => (
              <div
                key={project.id}
                onClick={() => setSelectedProject(project)}
                className={`p-3 rounded-lg cursor-pointer transition-colors ${
                  selectedProject?.id === project.id
                    ? 'bg-blue-50 border border-blue-200'
                    : 'hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Folder className="w-4 h-4 text-blue-600" />
                    <span className="font-medium text-gray-900">
                      {project.name}
                    </span>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowShareModal(true);
                    }}
                    className="p-1 hover:bg-gray-200 rounded"
                    title="Share Project"
                  >
                    <Share className="w-3 h-3 text-gray-500" />
                  </button>
                </div>
                <div className="flex items-center space-x-2 mt-1 text-xs text-gray-500">
                  <Users className="w-3 h-3" />
                  <span>{project.collaborators.length} collaborator(s)</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Files List */}
        {selectedProject && (
          <div className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-700">Files</h3>
              <button
                onClick={() => addFileToProject(selectedProject.id)}
                className="text-xs text-blue-600 hover:text-blue-700"
              >
                + Add File
              </button>
            </div>
            <div className="space-y-1">
              {selectedProject.files.map((file) => (
                <div
                  key={file}
                  onClick={() => setSelectedFile(file)}
                  className={`flex items-center space-x-2 p-2 rounded-lg cursor-pointer transition-colors ${
                    selectedFile === file
                      ? 'bg-green-50 border border-green-200'
                      : 'hover:bg-gray-50'
                  }`}
                >
                  <FileText className="w-4 h-4 text-gray-500" />
                  <span className="text-sm text-gray-700">{file}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Collaborators */}
        {selectedProject && (
          <CollaboratorsList
            collaborators={selectedProject.collaborators}
            currentUser={user}
            owner={owner}
          />
        )}
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <header className="bg-white border-b border-gray-200 px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <Menu className="w-5 h-5" />
              </button>
              <div>
                <h1 className="text-xl font-semibold text-gray-900">
                  {selectedProject?.name || 'Select a Project'}
                </h1>
                {selectedFile && (
                  <p className="text-sm text-gray-500">
                    Editing: {selectedFile}
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center space-x-3">
              <span className="text-sm text-gray-600">
                Welcome, {user.name}
              </span>
              <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center">
                <span className="text-white text-sm font-medium">
                  {user.name.charAt(0).toUpperCase()}
                </span>
              </div>
            </div>
          </div>
        </header>

        {/* Editor */}
        <div className="flex-1">
          {selectedProject && selectedFile ? (
            <ProjectEditor
              project={selectedProject}
              fileName={selectedFile}
              user={user}
              onCollaboratorsChange={(collabs) =>
                setProjects((prev) => {
                  const updatedProjects = prev.map((p) =>
                    p.id === selectedProject.id
                      ? { ...p, collaborators: collabs }
                      : p,
                  ) as Project[];
                  setSelectedProject(
                    updatedProjects.find((p) => p.id === selectedProject.id),
                  );
                  return updatedProjects;
                })
              }
            />
          ) : (
            <div className="h-full flex items-center justify-center text-gray-500">
              <div className="text-center">
                <FileText className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                <p className="text-lg mb-2">No file selected</p>
                <p className="text-sm">
                  Choose a project and file to start editing
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {selectedProject && (
        <ShareModal
          showShareModal={showShareModal}
          setShowShareModal={setShowShareModal}
          ownerEmail={user.email}
          projectId={selectedProject.id}
        />
      )}
    </div>
  );
};

export default Dashboard;
