import { Injectable } from '@angular/core';

interface EventCallback {
  (data?: any): void;
}
@Injectable({
  providedIn: 'root'
})


export class EventManagerService {
  private events: { [key: string]: EventCallback[] } = {};

  public on(eventName: string, callback: EventCallback): void {
    if (!this.events[eventName]) {
      this.events[eventName] = [];
    }
    this.events[eventName].push(callback);
  }

  public off(eventName: string, callback: EventCallback): void {
    if (!this.events[eventName]) return;

    this.events[eventName] = this.events[eventName].filter(cb => cb !== callback);
  }

  public trigger(eventName: string, data?: any): void {
    if (!this.events[eventName]) return;

    this.events[eventName].forEach(callback => callback(data));
  }
}
