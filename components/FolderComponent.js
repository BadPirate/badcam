import React from 'react'
import { Alert } from 'react-bootstrap';
import { EventComponent } from './EventComponent';

/** @typedef {typeof import('dropbox')} Dropbox */

class Event {
  prefix=null
  front=null
  left=null
  right=null
  preview=null
  highlight=null
  crunch=null
  folder=null

  hasOriginals() {
    return (this.left && this.right && this.front)
  }
}

export class FolderComponent extends React.Component {
  state={
    message: "Loading...",
    variant: "info",
    events: null
  }

  render() {
    let folder = this.props.folder
    let message = this.state.message
    let variant = this.state.variant
    let events = this.state.events
    let box = this.props.box
    let account = this.props.account

    if (events && events.length == 0) return null
    if (folder[".tag"] != "folder") return null
    let regex = /(\d\d\d\d)-(\d\d)-(\d\d)_(\d\d)-(\d\d)-(\d\d)/
    let nameParts = regex.exec(folder.name)
    if (nameParts.length < 7) return null
    return (
      <tr>
        <td>
        { message ? <Alert variant={variant}>{message}</Alert> : null}
        { events ? events.map(event => {
            return <EventComponent key={event.prefix} event={event} box={box} account={account}/>
          }) : null}
        </td>
      </tr>
    );
  }

  componentDidMount() {
    /** @param Dropbox box */
    let box = this.props.box
    let folder = this.props.folder

    box.filesListFolder({path: folder.path_lower}).then( (result, error) => {
      if (error) {
        this.setState({
          message: "Unable to load folder",
          variant: "danger"
        })
        return
      }
      var events = new Map()
      let regex = /(\d\d\d\d-\d\d-\d\d_\d\d-\d\d-\d\d)-(.*)\.(.*)/
      this.setState({
        message: "Loading events...",
        variant: "info"
      })
      result.entries.forEach(file => {
        let parts = regex.exec(file.name)
        if (parts.length < 0) return
        let [ _, prefix, type ] = parts
        if (!events.has(prefix)) {
          events.set(prefix, new Event())
        }
        let event = events.get(prefix)
        event.prefix = prefix
        event.folder = folder.path_lower
        switch(type) {
          case "front": event.front = file; break
          case "left_repeater": event.left = file; break
          case "right_repeater": event.right = file; break
          case "preview": event.preview = file; break
          case "crunch": event.crunch = file; break
          case "highlight": event.highlight = file; break
        }
      })
      this.setState({
        message: null,
        variant: null,
        events: Array.from(events.values())
      })
    })
  }
}
