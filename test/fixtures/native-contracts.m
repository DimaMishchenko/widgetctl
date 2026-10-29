#import "../../native/worker.m"
#import <stdbool.h>

static id currentManager;
static id currentDescriptor;

@interface SBIconController : NSObject
+ (id)sharedInstance;
- (id)iconManager;
@end
@implementation SBIconController
+ (id)sharedInstance { static SBIconController *instance; if (!instance) instance = [self new]; return instance; }
- (id)iconManager { return currentManager; }
@end

@interface ScalarGetter : NSObject
- (unsigned long)count;
- (id)value:(id)argument;
@end
@implementation ScalarGetter
- (unsigned long)count { return 1; }
- (NSString *)description { return @"private-runtime-payload"; }
- (id)value:(id)argument { return argument; }
@end

@interface FixtureDescriptor : NSObject
@property(nonatomic, copy) NSString *extension;
@property(nonatomic, copy) NSString *container;
- (id)kind;
- (id)extensionBundleIdentifier;
- (id)containerBundleIdentifier;
- (unsigned long)supportedFamilies;
@end
@implementation FixtureDescriptor
- (id)kind { return @"Kind"; }
- (id)extensionBundleIdentifier { return self.extension; }
- (id)containerBundleIdentifier { return self.container; }
- (unsigned long)supportedFamilies { return 1UL << 1; }
@end

@interface FixtureProvider : NSObject
- (id)sbh_descriptorsByExtensionIdentifier;
- (id)sbh_descriptorWithKind:(id)kind extensionBundleIdentifier:(id)extension containerBundleIdentifier:(id)container;
@end
@implementation FixtureProvider
- (id)sbh_descriptorsByExtensionIdentifier { return @{@"org.widgets": @[currentDescriptor]}; }
- (id)sbh_descriptorWithKind:(id)kind extensionBundleIdentifier:(id)extension containerBundleIdentifier:(id)container {
    (void)kind; (void)extension; (void)container;
    return currentDescriptor;
}
@end

@interface BaseManager : NSObject
- (id)widgetExtensionProvider;
- (void)_ensureWidgetIsVisibleForDebuggingWithDescriptor:(id)descriptor sizeClass:(long)size;
@end
@implementation BaseManager
- (id)widgetExtensionProvider { return [FixtureProvider new]; }
- (void)_ensureWidgetIsVisibleForDebuggingWithDescriptor:(id)descriptor sizeClass:(long)size { (void)descriptor; (void)size; }
@end

@interface MissingRemoveManager : BaseManager
- (void)revealIcon:(id)icon animated:(bool)animated completionHandler:(void (^)(void))completion;
@end
@implementation MissingRemoveManager
- (void)revealIcon:(id)icon animated:(bool)animated completionHandler:(void (^)(void))completion { (void)icon; (void)animated; (void)completion; }
@end

@interface MissingRevealManager : BaseManager
- (void)removeIcon:(id)icon options:(unsigned long long)options undoActionName:(id)name completion:(void (^)(void))completion;
@end
@implementation MissingRevealManager
- (void)removeIcon:(id)icon options:(unsigned long long)options undoActionName:(id)name completion:(void (^)(void))completion { (void)icon; (void)options; (void)name; (void)completion; }
@end

@interface LegacyRemoveManager : BaseManager
- (void)removeIcon:(id)icon options:(unsigned long long)options completion:(void (^)(void))completion;
@end
@implementation LegacyRemoveManager
- (void)removeIcon:(id)icon options:(unsigned long long)options completion:(void (^)(void))completion { (void)icon; (void)options; (void)completion; }
@end

@interface WrongLegacyRemoveManager : BaseManager
- (void)removeIcon:(id)icon options:(int)options completion:(void (^)(void))completion;
@end
@implementation WrongLegacyRemoveManager
- (void)removeIcon:(id)icon options:(int)options completion:(void (^)(void))completion { (void)icon; (void)options; (void)completion; }
@end

@interface WrongModernRemoveManager : LegacyRemoveManager
- (void)removeIcon:(id)icon options:(int)options undoActionName:(id)name completion:(void (^)(void))completion;
@end
@implementation WrongModernRemoveManager
- (void)removeIcon:(id)icon options:(int)options undoActionName:(id)name completion:(void (^)(void))completion { (void)icon; (void)options; (void)name; (void)completion; }
@end

static void expectException(NSString *name, NSString *reason, void (^action)(void)) {
    BOOL rejected = NO;
    @try { action(); }
    @catch (NSException *exception) {
        if (![exception.name isEqual:name] || ![exception.reason containsString:reason]) @throw;
        rejected = YES;
    }
    if (!rejected) [NSException raise:@"HarnessFailure" format:@"Expected %@ containing %@", name, reason];
}

int main(void) {
    @autoreleasepool {
        @try {
            expectException(@"UnavailableABI", @"object getter", ^{ objectMessage([ScalarGetter new], "count"); });
            id controller = objectMessage(SBIconController.class, "sharedInstance");
            if (![controller isKindOfClass:SBIconController.class]) [NSException raise:@"HarnessFailure" format:@"Class singleton getter failed"];
            expectException(@"UnavailableABI", @"value:", ^{ requireMethod([ScalarGetter new], "value:", "@16@0:8"); });

            FixtureDescriptor *descriptor = [FixtureDescriptor new];
            descriptor.extension = @"org.widgets";
            descriptor.container = @"org.app";
            currentDescriptor = descriptor;
            currentManager = [MissingRemoveManager new];
            NSDictionary *desired = @{@"kind": @"Kind", @"extension": @"org.widgets", @"container": @"org.app", @"size": @"small"};
            id found = descriptorForWidget(currentManager, desired, NSMutableDictionary.dictionary);
            if (found != descriptor) [NSException raise:@"HarnessFailure" format:@"Matching descriptor rejected"];

            descriptor.extension = @"other.widgets";
            expectException(@"DescriptorMismatch", @"extension", ^{ descriptorForWidget(currentManager, desired, NSMutableDictionary.dictionary); });
            descriptor.extension = @"org.widgets";
            descriptor.container = @"other.app";
            expectException(@"DescriptorMismatch", @"container", ^{ descriptorForWidget(currentManager, desired, NSMutableDictionary.dictionary); });
            descriptor.container = @"org.app";

            NSDictionary *batch = @{@"targets": @[@{}], @"desired": desired};
            NSMutableDictionary *response = NSMutableDictionary.dictionary;
            expectException(@"UnavailableABI", @"removeIcon:", ^{ validateExistingWidgets(batch, response); });
            if (response[@"status"]) [NSException raise:@"HarnessFailure" format:@"Missing removal ABI published a status"];
            currentManager = [MissingRevealManager new];
            expectException(@"UnavailableABI", @"revealIcon:", ^{ validateExistingWidgets(batch, response); });
            if (response[@"status"]) [NSException raise:@"HarnessFailure" format:@"Missing reveal ABI published a status"];
            if (widgetRemovalSelector([LegacyRemoveManager new]) != sel_registerName("removeIcon:options:completion:"))
                [NSException raise:@"HarnessFailure" format:@"Legacy removal selector was not selected"];
            if (widgetRemovalSelector([MissingRevealManager new]) != sel_registerName("removeIcon:options:undoActionName:completion:"))
                [NSException raise:@"HarnessFailure" format:@"Modern removal selector was not selected"];
            expectException(@"UnavailableABI", @"removeIcon:options:completion:", ^{ widgetRemovalSelector([WrongLegacyRemoveManager new]); });
            expectException(@"UnavailableABI", @"removeIcon:options:undoActionName:completion:", ^{ widgetRemovalSelector([WrongModernRemoveManager new]); });
            currentManager = [LegacyRemoveManager new];
            expectException(@"UnavailableABI", @"revealIcon:", ^{ validateExistingWidgets(batch, response); });
            @try { objectMessage([ScalarGetter new], "count"); }
            @catch (NSException *exception) {
                if ([exception.reason containsString:@"private-runtime-payload"] || ![exception.reason containsString:@"ScalarGetter"])
                    [NSException raise:@"HarnessFailure" format:@"Object getter ABI error exposed a native description"];
            }
            @try { requireMethod([ScalarGetter new], "value:", "@16@0:8"); }
            @catch (NSException *exception) {
                if ([exception.reason containsString:@"private-runtime-payload"] || ![exception.reason containsString:@"ScalarGetter"])
                    [NSException raise:@"HarnessFailure" format:@"Method ABI error exposed a native description"];
            }
            NSString *responsePath = [NSTemporaryDirectory() stringByAppendingPathComponent:NSUUID.UUID.UUIDString];
            NSString *nonce = NSUUID.UUID.UUIDString;
            @try {
                saveJSON(@{@"nonce": nonce, @"opaque": [NSObject new]}, responsePath);
                NSDictionary *saved = [NSJSONSerialization JSONObjectWithData:[NSData dataWithContentsOfFile:responsePath] options:0 error:nil];
                if (![saved[@"status"] isEqual:@"error"] || ![saved[@"nonce"] isEqual:nonce] || ![saved[@"error"] containsString:@"non-JSON"])
                    [NSException raise:@"HarnessFailure" format:@"Non-JSON worker response did not fail safely"];
            } @finally {
                [NSFileManager.defaultManager removeItemAtPath:responsePath error:nil];
            }
            puts("native contracts: 16 checks passed");
            return 0;
        } @catch (NSException *exception) {
            fprintf(stderr, "%s: %s\n", exception.name.UTF8String, exception.reason.UTF8String);
            return 1;
        }
    }
}
