import {
    Component,
    ComponentFactoryResolver,
    OnInit,
    ViewChild,
    ViewContainerRef,
} from '@angular/core';
import {
    ActivatedRoute,
    Router,
} from '@angular/router';

import { ToasterService } from 'angular2-toaster';

import { ValidationService } from 'jslib/angular/services/validation.service';
import { ConstantsService } from 'jslib/services/constants.service';

import { ApiService } from 'jslib/abstractions/api.service';
import { CryptoService } from 'jslib/abstractions/crypto.service';
import { I18nService } from 'jslib/abstractions/i18n.service';
import { PlatformUtilsService } from 'jslib/abstractions/platformUtils.service';
import { SearchService } from 'jslib/abstractions/search.service';
import { StorageService } from 'jslib/abstractions/storage.service';
import { UserService } from 'jslib/abstractions/user.service';

import { OrganizationUserConfirmRequest } from 'jslib/models/request/organizationUserConfirmRequest';

import { OrganizationUserBulkRequest } from 'jslib/models/request/organizationUserBulkRequest';
import { OrganizationUserUserDetailsResponse } from 'jslib/models/response/organizationUserResponse';

import { OrganizationUserStatusType } from 'jslib/enums/organizationUserStatusType';
import { OrganizationUserType } from 'jslib/enums/organizationUserType';

import { Utils } from 'jslib/misc/utils';

import { ModalComponent } from '../../modal.component';
import { EntityEventsComponent } from './entity-events.component';
import { UserAddEditComponent } from './user-add-edit.component';
import { UserConfirmComponent } from './user-confirm.component';
import { UserGroupsComponent } from './user-groups.component';

const MaxCheckedCount = 500;

@Component({
    selector: 'app-org-people',
    templateUrl: 'people.component.html',
})
export class PeopleComponent implements OnInit {
    @ViewChild('addEdit', { read: ViewContainerRef, static: true }) addEditModalRef: ViewContainerRef;
    @ViewChild('groupsTemplate', { read: ViewContainerRef, static: true }) groupsModalRef: ViewContainerRef;
    @ViewChild('eventsTemplate', { read: ViewContainerRef, static: true }) eventsModalRef: ViewContainerRef;
    @ViewChild('confirmTemplate', { read: ViewContainerRef, static: true }) confirmModalRef: ViewContainerRef;

    loading = true;
    organizationId: string;
    users: OrganizationUserUserDetailsResponse[];
    pagedUsers: OrganizationUserUserDetailsResponse[];
    searchText: string;
    status: OrganizationUserStatusType = null;
    statusMap = new Map<OrganizationUserStatusType, OrganizationUserUserDetailsResponse[]>();
    organizationUserType = OrganizationUserType;
    organizationUserStatusType = OrganizationUserStatusType;
    actionPromise: Promise<any>;
    accessEvents = false;
    accessGroups = false;

    protected didScroll = false;
    protected pageSize = 100;

    private pagedUsersCount = 0;
    private modal: ModalComponent = null;
    private allUsers: OrganizationUserUserDetailsResponse[];

    constructor(private apiService: ApiService, private route: ActivatedRoute,
        private i18nService: I18nService, private componentFactoryResolver: ComponentFactoryResolver,
        private platformUtilsService: PlatformUtilsService, private toasterService: ToasterService,
        private cryptoService: CryptoService, private userService: UserService, private router: Router,
        private storageService: StorageService, private searchService: SearchService,
        private validationService: ValidationService) { }

    async ngOnInit() {
        this.route.parent.parent.params.subscribe(async params => {
            this.organizationId = params.organizationId;
            const organization = await this.userService.getOrganization(this.organizationId);
            if (!organization.canManageUsers) {
                this.router.navigate(['../collections'], { relativeTo: this.route });
                return;
            }
            this.accessEvents = organization.useEvents;
            this.accessGroups = organization.useGroups;
            await this.load();

            const queryParamsSub = this.route.queryParams.subscribe(async qParams => {
                this.searchText = qParams.search;
                if (qParams.viewEvents != null) {
                    const user = this.users.filter(u => u.id === qParams.viewEvents);
                    if (user.length > 0 && user[0].status === OrganizationUserStatusType.Confirmed) {
                        this.events(user[0]);
                    }
                }
                if (queryParamsSub != null) {
                    queryParamsSub.unsubscribe();
                }
            });
        });
    }

    async load() {
        const response = await this.apiService.getOrganizationUsers(this.organizationId);
        this.statusMap.clear();
        this.allUsers = response.data != null && response.data.length > 0 ? response.data : [];
        this.allUsers.sort(Utils.getSortFunction(this.i18nService, 'email'));
        this.allUsers.forEach(u => {
            if (!this.statusMap.has(u.status)) {
                this.statusMap.set(u.status, [u]);
            } else {
                this.statusMap.get(u.status).push(u);
            }
        });
        this.filter(this.status);
        this.loading = false;
    }

    filter(status: OrganizationUserStatusType) {
        this.status = status;
        if (this.status != null) {
            this.users = this.statusMap.get(this.status);
        } else {
            this.users = this.allUsers;
        }
        // Reset checkbox selecton
        this.selectAll(false);
        this.resetPaging();
    }

    loadMore() {
        if (!this.users || this.users.length <= this.pageSize) {
            return;
        }
        const pagedLength = this.pagedUsers.length;
        let pagedSize = this.pageSize;
        if (pagedLength === 0 && this.pagedUsersCount > this.pageSize) {
            pagedSize = this.pagedUsersCount;
        }
        if (this.users.length > pagedLength) {
            this.pagedUsers = this.pagedUsers.concat(this.users.slice(pagedLength, pagedLength + pagedSize));
        }
        this.pagedUsersCount = this.pagedUsers.length;
        this.didScroll = this.pagedUsers.length > this.pageSize;
    }

    get allCount() {
        return this.allUsers != null ? this.allUsers.length : 0;
    }

    get invitedCount() {
        return this.statusMap.has(OrganizationUserStatusType.Invited) ?
            this.statusMap.get(OrganizationUserStatusType.Invited).length : 0;
    }

    get acceptedCount() {
        return this.statusMap.has(OrganizationUserStatusType.Accepted) ?
            this.statusMap.get(OrganizationUserStatusType.Accepted).length : 0;
    }

    get confirmedCount() {
        return this.statusMap.has(OrganizationUserStatusType.Confirmed) ?
            this.statusMap.get(OrganizationUserStatusType.Confirmed).length : 0;
    }

    get showConfirmUsers(): boolean {
        return this.allUsers != null && this.statusMap != null && this.allUsers.length > 1 &&
            this.confirmedCount > 0 && this.confirmedCount < 3 && this.acceptedCount > 0;
    }

    edit(user: OrganizationUserUserDetailsResponse) {
        if (this.modal != null) {
            this.modal.close();
        }

        const factory = this.componentFactoryResolver.resolveComponentFactory(ModalComponent);
        this.modal = this.addEditModalRef.createComponent(factory).instance;
        const childComponent = this.modal.show<UserAddEditComponent>(
            UserAddEditComponent, this.addEditModalRef);

        childComponent.name = user != null ? user.name || user.email : null;
        childComponent.organizationId = this.organizationId;
        childComponent.organizationUserId = user != null ? user.id : null;
        childComponent.onSavedUser.subscribe(() => {
            this.modal.close();
            this.load();
        });
        childComponent.onDeletedUser.subscribe(() => {
            this.modal.close();
            this.removeUser(user);
        });

        this.modal.onClosed.subscribe(() => {
            this.modal = null;
        });
    }

    invite() {
        this.edit(null);
    }

    groups(user: OrganizationUserUserDetailsResponse) {
        if (this.modal != null) {
            this.modal.close();
        }

        const factory = this.componentFactoryResolver.resolveComponentFactory(ModalComponent);
        this.modal = this.groupsModalRef.createComponent(factory).instance;
        const childComponent = this.modal.show<UserGroupsComponent>(
            UserGroupsComponent, this.groupsModalRef);

        childComponent.name = user != null ? user.name || user.email : null;
        childComponent.organizationId = this.organizationId;
        childComponent.organizationUserId = user != null ? user.id : null;
        childComponent.onSavedUser.subscribe(() => {
            this.modal.close();
        });

        this.modal.onClosed.subscribe(() => {
            this.modal = null;
        });
    }

    async remove(user: OrganizationUserUserDetailsResponse) {
        const confirmed = await this.platformUtilsService.showDialog(
            this.i18nService.t('removeUserConfirmation'), user.name || user.email,
            this.i18nService.t('yes'), this.i18nService.t('no'), 'warning');
        if (!confirmed) {
            return false;
        }

        this.actionPromise = this.apiService.deleteOrganizationUser(this.organizationId, user.id);
        try {
            await this.actionPromise;
            this.toasterService.popAsync('success', null, this.i18nService.t('removedUserId', user.name || user.email));
            this.removeUser(user);
        } catch (e) {
            this.validationService.showError(e);
        }
        this.actionPromise = null;
    }

    async reinvite(user: OrganizationUserUserDetailsResponse) {
        if (this.actionPromise != null) {
            return;
        }

        this.actionPromise = this.apiService.postOrganizationUserReinvite(this.organizationId, user.id);
        try {
            await this.actionPromise;
            this.toasterService.popAsync('success', null, this.i18nService.t('hasBeenReinvited', user.name || user.email));
        } catch (e) {
            this.validationService.showError(e);
        }
        this.actionPromise = null;
    }

    async bulkRemove() {
        if (this.actionPromise != null) {
            return;
        }

        const users = this.getCheckedUsers();
        if (users.length <= 0) {
            this.toasterService.popAsync('error', this.i18nService.t('errorOccurred'),
                this.i18nService.t('noSelectedUsersApplicable'));
            return;
        }

        const confirmed = await this.platformUtilsService.showDialog(
            this.i18nService.t('removeSelectedUsersConfirmation'), this.i18nService.t('remove'),
            this.i18nService.t('yes'), this.i18nService.t('no'), 'warning');
        if (!confirmed) {
            return false;
        }

        const request = new OrganizationUserBulkRequest(users.map(user => user.id));
        this.actionPromise = this.apiService.deleteManyOrganizationUsers(this.organizationId, request);
        try {
            await this.actionPromise;
            this.toasterService.popAsync('success', null, this.i18nService.t('usersHasBeenRemoved'));
            await this.load();
        } catch (e) {
            this.validationService.showError(e);
        }
        this.actionPromise = null;
    }

    async bulkReinvite() {
        if (this.actionPromise != null) {
            return;
        }

        const users = this.getCheckedUsers().filter(u => u.status === OrganizationUserStatusType.Invited);

        if (users.length <= 0) {
            this.toasterService.popAsync('error', this.i18nService.t('errorOccurred'),
                this.i18nService.t('noSelectedUsersApplicable'));
            return;
        }

        const request = new OrganizationUserBulkRequest(users.map(user => user.id));
        this.actionPromise = this.apiService.postManyOrganizationUserReinvite(this.organizationId, request);
        try {
            await this.actionPromise;
            this.toasterService.popAsync('success', null, this.i18nService.t('usersHasBeenReinvited'));
        } catch (e) {
            this.validationService.showError(e);
        }
        this.actionPromise = null;
    }

    async confirm(user: OrganizationUserUserDetailsResponse) {
        function updateUser(self: PeopleComponent) {
            user.status = OrganizationUserStatusType.Confirmed;
            const mapIndex = self.statusMap.get(OrganizationUserStatusType.Accepted).indexOf(user);
            if (mapIndex > -1) {
                self.statusMap.get(OrganizationUserStatusType.Accepted).splice(mapIndex, 1);
                self.statusMap.get(OrganizationUserStatusType.Confirmed).push(user);
            }
        }

        const confirmUser = async (publicKey: Uint8Array) => {
            try {
                this.actionPromise = this.doConfirmation(user, publicKey);
                await this.actionPromise;
                updateUser(this);
                this.toasterService.popAsync('success', null, this.i18nService.t('hasBeenConfirmed', user.name || user.email));
            } catch (e) {
                this.validationService.showError(e);
                throw e;
            } finally {
                this.actionPromise = null;
            }
        };

        if (this.actionPromise != null) {
            return;
        }

        const autoConfirm = await this.storageService.get<boolean>(ConstantsService.autoConfirmFingerprints);
        if (autoConfirm == null || !autoConfirm) {
            if (this.modal != null) {
                this.modal.close();
            }

            const factory = this.componentFactoryResolver.resolveComponentFactory(ModalComponent);
            this.modal = this.confirmModalRef.createComponent(factory).instance;
            const childComponent = this.modal.show<UserConfirmComponent>(
                UserConfirmComponent, this.confirmModalRef);

            childComponent.name = user != null ? user.name || user.email : null;
            childComponent.organizationId = this.organizationId;
            childComponent.organizationUserId = user != null ? user.id : null;
            childComponent.userId = user != null ? user.userId : null;
            childComponent.onConfirmedUser.subscribe(async (publicKey: Uint8Array) => {
                try {
                    await confirmUser(publicKey);
                    this.modal.close();
                } catch (e) {
                    // tslint:disable-next-line
                    console.error('Handled exception:', e);
                }
            });

            this.modal.onClosed.subscribe(() => {
                this.modal = null;
            });
            return;
        }

        try {
            const publicKeyResponse = await this.apiService.getUserPublicKey(user.userId);
            const publicKey = Utils.fromB64ToArray(publicKeyResponse.publicKey);
            try {
                // tslint:disable-next-line
                console.log('User\'s fingerprint: ' +
                    (await this.cryptoService.getFingerprint(user.userId, publicKey.buffer)).join('-'));
            } catch { }
            await confirmUser(publicKey);
        } catch (e) {
            // tslint:disable-next-line
            console.error('Handled exception:', e);
        }
    }

    async events(user: OrganizationUserUserDetailsResponse) {
        if (this.modal != null) {
            this.modal.close();
        }

        const factory = this.componentFactoryResolver.resolveComponentFactory(ModalComponent);
        this.modal = this.eventsModalRef.createComponent(factory).instance;
        const childComponent = this.modal.show<EntityEventsComponent>(
            EntityEventsComponent, this.eventsModalRef);

        childComponent.name = user.name || user.email;
        childComponent.organizationId = this.organizationId;
        childComponent.entityId = user.id;
        childComponent.showUser = false;
        childComponent.entity = 'user';

        this.modal.onClosed.subscribe(() => {
            this.modal = null;
        });
    }

    async resetPaging() {
        this.pagedUsers = [];
        this.loadMore();
    }

    isSearching() {
        return this.searchService.isSearchable(this.searchText);
    }

    isPaging() {
        const searching = this.isSearching();
        if (searching && this.didScroll) {
            this.resetPaging();
        }
        return !searching && this.users && this.users.length > this.pageSize;
    }

    checkUser(user: OrganizationUserUserDetailsResponse, select?: boolean) {
        (user as any).checked = select == null ? !(user as any).checked : select;
    }

    selectAll(select: boolean) {
        if (select) {
            this.selectAll(false);
        }
        const selectCount = select && this.users.length > MaxCheckedCount
            ? MaxCheckedCount
            : this.users.length;
        for (let i = 0; i < selectCount; i++) {
            this.checkUser(this.users[i], select);
        }
    }

    private async doConfirmation(user: OrganizationUserUserDetailsResponse, publicKey: Uint8Array) {
        const orgKey = await this.cryptoService.getOrgKey(this.organizationId);
        const key = await this.cryptoService.rsaEncrypt(orgKey.key, publicKey.buffer);
        const request = new OrganizationUserConfirmRequest();
        request.key = key.encryptedString;
        await this.apiService.postOrganizationUserConfirm(this.organizationId, user.id, request);
    }

    private removeUser(user: OrganizationUserUserDetailsResponse) {
        let index = this.users.indexOf(user);
        if (index > -1) {
            this.users.splice(index, 1);
            this.resetPaging();
        }
        if (this.statusMap.has(OrganizationUserStatusType.Accepted)) {
            index = this.statusMap.get(OrganizationUserStatusType.Accepted).indexOf(user);
            if (index > -1) {
                this.statusMap.get(OrganizationUserStatusType.Accepted).splice(index, 1);
            }
        }
        if (this.statusMap.has(OrganizationUserStatusType.Invited)) {
            index = this.statusMap.get(OrganizationUserStatusType.Invited).indexOf(user);
            if (index > -1) {
                this.statusMap.get(OrganizationUserStatusType.Invited).splice(index, 1);
            }
        }
        if (this.statusMap.has(OrganizationUserStatusType.Confirmed)) {
            index = this.statusMap.get(OrganizationUserStatusType.Confirmed).indexOf(user);
            if (index > -1) {
                this.statusMap.get(OrganizationUserStatusType.Confirmed).splice(index, 1);
            }
        }
    }

    private getCheckedUsers() {
        return this.users.filter(u => (u as any).checked);
    }
}
