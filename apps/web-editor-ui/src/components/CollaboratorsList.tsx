import React, { useState } from 'react';
import {
  Users,
  Crown,
  Eye,
  Edit,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { User, Collaborator } from '@frelated/types';

interface CollaboratorsListProps {
  collaborators: Collaborator[];
  currentUser: User;
  owner?: string; // email of owner, optional
}

const CollaboratorsList: React.FC<CollaboratorsListProps> = ({
  collaborators,
  currentUser,
  owner,
}) => {
  const [isExpanded, setIsExpanded] = useState(true);

  const getPermissionIcon = (collaborator: Collaborator) => {
    if (owner) {
      if (collaborator.email === owner) {
        return <Crown className="w-3 h-3 text-yellow-600" />;
      }
    } else {
      if (collaborator.email === currentUser.email) {
        return <Crown className="w-3 h-3 text-yellow-600" />;
      }
    }

    if (collaborator.role === 'viewer') {
      return <Eye className="w-3 h-3 text-blue-600" />;
    }
    return <Edit className="w-3 h-3 text-green-600" />;
  };

  const getStatusColor = (isOnline: boolean) => {
    return isOnline ? 'bg-green-500' : 'bg-gray-400';
  };

  return (
    <div className="border-t border-gray-200 p-4">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center justify-between w-full mb-3 text-sm font-semibold text-gray-700 hover:text-gray-900"
      >
        <div className="flex items-center space-x-2">
          <Users className="w-4 h-4" />
          <span>Collaborators ({collaborators.length})</span>
        </div>
        {isExpanded ? (
          <ChevronDown className="w-4 h-4" />
        ) : (
          <ChevronRight className="w-4 h-4" />
        )}
      </button>

      {/* List */}
      {isExpanded && (
        <div className="space-y-2">
          {collaborators.map((collaborator, index) => (
            <div
              key={collaborator.email || index}
              className="flex items-center justify-between p-2 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center space-x-3">
                {/* Avatar */}
                <div className="relative">
                  <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center">
                    <span className="text-white text-xs font-medium">
                      {collaborator.name?.charAt(0).toUpperCase() || '?'}
                    </span>
                  </div>
                  <div
                    className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 border-2 border-white rounded-full ${getStatusColor(
                      collaborator.isOnline !== false,
                    )}`}
                    title={
                      collaborator.isOnline !== false ? 'Online' : 'Offline'
                    }
                  />
                </div>

                {/* Details */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center space-x-2">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {collaborator.name || 'Anonymous'}
                      {collaborator.email === currentUser.email && (
                        <span className="text-xs text-gray-500 ml-1">
                          (You)
                        </span>
                      )}
                    </p>
                    {getPermissionIcon(collaborator)}
                  </div>
                  <p className="text-xs text-gray-500 truncate">
                    {collaborator.email || 'No email provided'}
                  </p>
                </div>
              </div>
            </div>
          ))}

          {/* Empty state */}
          {collaborators.length === 1 &&
            collaborators[0].email === currentUser.email && (
              <div className="text-center py-4 text-gray-500">
                <Users className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                <p className="text-sm">No other collaborators yet</p>
                <p className="text-xs">
                  Share the project to start collaborating
                </p>
              </div>
            )}
        </div>
      )}
    </div>
  );
};

export default CollaboratorsList;
