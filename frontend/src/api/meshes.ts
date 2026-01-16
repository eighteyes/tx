import axios from 'axios';
import type { MeshConfig, MeshMetadata, ValidationError } from '../types/mesh';

const API_BASE = '/v1';

export const meshAPI = {
  async listMeshes(): Promise<{ meshes: MeshMetadata[] }> {
    const response = await axios.get(`${API_BASE}/meshes`);
    return response.data;
  },

  async getMesh(name: string): Promise<{
    name: string;
    config: MeshConfig;
    raw: string;
    configType: 'yaml' | 'json';
  }> {
    const response = await axios.get(`${API_BASE}/meshes/${name}`);
    return response.data;
  },

  async updateMesh(name: string, config: MeshConfig, format: 'yaml' | 'json'): Promise<{
    success: boolean;
    errors?: ValidationError[];
  }> {
    const response = await axios.put(`${API_BASE}/meshes/${name}`, {
      config,
      format,
    });
    return response.data;
  },

  async validateMesh(name: string, config: MeshConfig): Promise<{
    valid: boolean;
    errors?: ValidationError[];
    warnings?: string[];
  }> {
    const response = await axios.post(`${API_BASE}/meshes/${name}/validate`, {
      config,
    });
    return response.data;
  },
};
